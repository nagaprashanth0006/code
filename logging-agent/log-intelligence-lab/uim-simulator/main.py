"""
Enhanced UIM synthetic log simulator.

Improvements over original:
- Multi-line stack trace patterns (Oracle/Helidon style)
- pod / container JSON fields for K8s semantics detection
- Larger, more varied message pool per service
- On-demand incident HTTP control endpoint (POST /incident, /healthy, /mixed)
- SCENARIO env var still works as before; control endpoint overrides at runtime
"""

import json
import os
import random
import signal
import sys
import time
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer


SERVICE_NAME = os.getenv("SERVICE_NAME", "uim-apps")
NAMESPACE = os.getenv("NAMESPACE", "uim-demo")
ENVIRONMENT = os.getenv("APP_ENV", "local-demo")
SCENARIO = os.getenv("SCENARIO", "mixed")
ERROR_RATE = float(os.getenv("ERROR_RATE", "0.18"))
INTERVAL_SECS = float(os.getenv("INTERVAL_SECS", "0.8"))
CONTROL_PORT = int(os.getenv("CONTROL_PORT", "9001"))

RUNNING = True


# ── Message pools ────────────────────────────────────────────────────────────

NORMAL_MESSAGES = {
    "uim-auth": [
        "Authentication request completed successfully user=demo tenant=default",
        "Token validation completed subject=demo-user scope=uim.read",
        "Authorization cache refresh completed entries=128",
        "JWT signing key rotated key_id=key-{request_id} algorithm=RS256",
        "OIDC userinfo endpoint responded status=200 duration_ms=42",
        "Session created session_id=sess-{request_id} user=operator@uim",
        "Rate limit counter reset bucket=api tenant=default",
    ],
    "uim-apps": [
        "Inventory search completed entity=LogicalDevice count=24 duration_ms=86",
        "Provisioning workflow state advanced order=ORD-{order_id} state=ASSIGNED",
        "REST request completed path=/Inventory status=200 duration_ms=112",
        "Service request fulfilled sr_id=SR-{order_id} type=ADD_SERVICE",
        "Resource reservation confirmed resource=EquipmentHolder-{order_id} order=ORD-{order_id}",
        "Workflow activity completed activity=AssignResource order=ORD-{order_id} duration_ms=310",
        "DB connection pool healthy pool=uim-ds active=4 idle=6 max=20",
        "Cache hit entity=LogicalDevice id={order_id} cache=entity-cache",
    ],
    "uim-smart-search": [
        "Smart search query completed index=inventory_resource hits=12 duration_ms=74",
        "Search consumer batch processed topic=uim-search-events records=80 lag=0",
        "Autocomplete dictionary refreshed entries=640",
        "Index refresh completed index=inventory_resource docs=18432 duration_ms=2100",
        "Consumer offset committed topic=uim-search-events partition=0 offset={order_id}",
        "Search reindex triggered index=logical_device reason=schema_update",
    ],
    "uim-topology": [
        "Topology graph query completed vertices=34 edges=61 duration_ms=141",
        "PGX session reused graph=uim-topology active_sessions=2",
        "Topology consumer processed relationship update event_id=evt-{order_id}",
        "Graph snapshot refreshed vertices=12041 edges=28893 duration_ms=4200",
        "PGX in-memory graph loaded graph=uim-topology nodes=12041 duration_ms=6100",
        "Shortest path computed source=eid-{order_id} hops=3 duration_ms=88",
    ],
}

# Stack trace fragments by service (Oracle/Helidon/WebLogic patterns)
STACK_TRACES = {
    "uim-auth": (
        "java.lang.RuntimeException: Token validation failed\n"
        "\tat io.helidon.security.providers.jwt.JwtProvider.validateJwt(JwtProvider.java:214)\n"
        "\tat io.helidon.security.providers.jwt.JwtProvider.authenticate(JwtProvider.java:178)\n"
        "\tat oracle.uim.auth.security.AuthSecurityProvider.doAuthenticate(AuthSecurityProvider.java:92)\n"
        "\tat io.helidon.security.Security.authenticate(Security.java:411)\n"
        "\tat io.helidon.microprofile.security.SecurityFilter.filter(SecurityFilter.java:156)"
    ),
    "uim-apps": (
        "java.sql.SQLException: ORA-00060: deadlock detected while waiting for resource\n"
        "\tat oracle.jdbc.driver.T4CTTIoer11.processError(T4CTTIoer11.java:498)\n"
        "\tat oracle.jdbc.driver.T4CTTIoer11.processError(T4CTTIoer11.java:460)\n"
        "\tat oracle.jdbc.driver.T4C8Oall.processError(T4C8Oall.java:1088)\n"
        "\tat oracle.uim.provisioning.workflow.ReserveResourceActivity.execute(ReserveResourceActivity.java:187)\n"
        "\tat oracle.uim.provisioning.engine.WorkflowEngine.executeActivity(WorkflowEngine.java:342)\n"
        "Caused by: oracle.oss.ngoss.common.exception.NgossException: Deadlock rollback required"
    ),
    "uim-smart-search": (
        "org.opensearch.client.ResponseException: POST http://uim-search-os:9200/inventory_resource/_refresh [status: 503]\n"
        "\tat org.opensearch.client.RestClient.convertResponse(RestClient.java:347)\n"
        "\tat oracle.uim.search.indexing.OpenSearchIndexManager.refreshIndex(OpenSearchIndexManager.java:201)\n"
        "\tat oracle.uim.search.indexing.IndexRefreshJob.execute(IndexRefreshJob.java:88)\n"
        "Caused by: java.net.ConnectException: Connection refused to uim-smart-search-consumer:8080"
    ),
    "uim-topology": (
        "oracle.pgx.api.PgxException: Timeout waiting for PGX graph server response\n"
        "\tat oracle.pgx.api.PgxSession.queryPgql(PgxSession.java:628)\n"
        "\tat oracle.uim.topology.service.TopologyQueryService.executeGraphQuery(TopologyQueryService.java:315)\n"
        "\tat oracle.uim.topology.rest.TopologyResource.getGraph(TopologyResource.java:142)\n"
        "\tat sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)\n"
        "Caused by: java.util.concurrent.TimeoutException: PGX query exceeded 30000ms"
    ),
}

ISSUE_MESSAGES = {
    "uim-auth": [
        (
            "ERROR",
            "Internal server error while validating token request_id={request_id} "
            "component=UIMAuthService exception=HelidonWebServerException status=500",
        ),
        (
            "ERROR",
            "Token validation failed with exception request_id={request_id}\n{stacktrace}",
        ),
        (
            "WARN",
            "LDAP lookup latency exceeded threshold request_id={request_id} "
            "component=UIMAuthService duration_ms={duration_ms}",
        ),
        (
            "ERROR",
            "Authentication rejected: credential mismatch request_id={request_id} user=operator status=401",
        ),
    ],
    "uim-apps": [
        (
            "ERROR",
            "Inventory update failed request_id={request_id} entity=LogicalDevice "
            "error=ORA-00060 deadlock detected while waiting for resource",
        ),
        (
            "ERROR",
            "Database deadlock on provisioning request_id={request_id} order=ORD-{order_id}\n{stacktrace}",
        ),
        (
            "ERROR",
            "Provisioning workflow timeout request_id={request_id} order=ORD-{order_id} "
            "activity=ReserveResource duration_ms={duration_ms}",
        ),
        (
            "ERROR",
            "ORA-01555: snapshot too old request_id={request_id} entity=ServiceConfiguration "
            "rollback_segment=RBS_UNDO",
        ),
        (
            "WARN",
            "Connection pool exhausted request_id={request_id} pool=uim-ds "
            "active={duration_ms} max=20 wait_ms=5000",
        ),
    ],
    "uim-smart-search": [
        (
            "ERROR",
            "Search index refresh failed request_id={request_id} index=inventory_resource "
            "error=connection refused host=uim-smart-search-consumer",
        ),
        (
            "ERROR",
            "OpenSearch index refresh exception request_id={request_id}\n{stacktrace}",
        ),
        (
            "WARN",
            "Search consumer lag high request_id={request_id} topic=uim-search-events "
            "lag={lag} threshold=1000",
        ),
        (
            "ERROR",
            "Bulk indexing failed request_id={request_id} index=inventory_resource "
            "docs_failed=142 error=circuit_breaker_open",
        ),
    ],
    "uim-topology": [
        (
            "ERROR",
            "Topology PGX query failed request_id={request_id} graph=uim-topology "
            "error=Timeout waiting for graph server",
        ),
        (
            "ERROR",
            "PGX session error request_id={request_id}\n{stacktrace}",
        ),
        (
            "WARN",
            "Topology update queue delayed request_id={request_id} queue_depth={lag}",
        ),
        (
            "ERROR",
            "Graph consistency check failed graph=uim-topology "
            "vertices_missing={lag} error=stale_snapshot",
        ),
    ],
}


# ── Control server ────────────────────────────────────────────────────────────

class ControlHandler(BaseHTTPRequestHandler):
    """Tiny HTTP server for on-demand scenario switching."""

    def do_POST(self):
        global SCENARIO, ERROR_RATE
        path = self.path.rstrip("/").lower()
        if path == "/incident":
            SCENARIO = "incident"
            ERROR_RATE = 0.9
            body = b'{"status":"ok","scenario":"incident"}'
        elif path == "/healthy":
            SCENARIO = "healthy"
            ERROR_RATE = 0.0
            body = b'{"status":"ok","scenario":"healthy"}'
        elif path == "/mixed":
            SCENARIO = "mixed"
            ERROR_RATE = float(os.getenv("ERROR_RATE", "0.18"))
            body = b'{"status":"ok","scenario":"mixed"}'
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        body = json.dumps({
            "service": SERVICE_NAME,
            "scenario": SCENARIO,
            "error_rate": ERROR_RATE,
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # suppress access logs


def _start_control_server():
    try:
        server = HTTPServer(("0.0.0.0", CONTROL_PORT), ControlHandler)
        server.serve_forever()
    except Exception as exc:
        _emit("WARN", f"Control server failed to start port={CONTROL_PORT} error={exc}")


# ── Emission ─────────────────────────────────────────────────────────────────

def _emit(level, message):
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "namespace": NAMESPACE,
        "pod": f"{SERVICE_NAME}-{random.randint(1000,9999)}",
        "container": SERVICE_NAME,
        "app": SERVICE_NAME,
        "service": SERVICE_NAME,
        "environment": ENVIRONMENT,
        "scenario": SCENARIO,
        "message": message,
    }
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def _render(template):
    """Expand {placeholders} in a message template."""
    stacktrace = STACK_TRACES.get(SERVICE_NAME, "")
    return template.format(
        request_id=f"REQ-{random.randint(100000, 999999)}",
        duration_ms=random.randint(1800, 12000),
        order_id=random.randint(10000, 99999),
        lag=random.randint(1200, 9000),
        stacktrace=stacktrace,
    )


def _issue_message():
    pool = ISSUE_MESSAGES.get(SERVICE_NAME, ISSUE_MESSAGES["uim-apps"])
    level, template = random.choice(pool)
    return level, _render(template)


def _normal_message():
    pool = NORMAL_MESSAGES.get(SERVICE_NAME, NORMAL_MESSAGES["uim-apps"])
    return _render(random.choice(pool))


def _stop(_signum, _frame):
    global RUNNING
    RUNNING = False


# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    threading.Thread(target=_start_control_server, daemon=True).start()
    _emit("INFO", (
        f"Started enhanced UIM simulator service={SERVICE_NAME} "
        f"namespace={NAMESPACE} scenario={SCENARIO} "
        f"error_rate={ERROR_RATE} control_port={CONTROL_PORT}"
    ))

    while RUNNING:
        if SCENARIO == "healthy":
            _emit("INFO", _normal_message())
        elif SCENARIO == "incident" or random.random() < ERROR_RATE:
            level, message = _issue_message()
            _emit(level, message)
        else:
            _emit("INFO", _normal_message())
        time.sleep(max(INTERVAL_SECS + random.uniform(-0.2, 0.4), 0.1))

    _emit("INFO", f"Stopped synthetic UIM simulator service={SERVICE_NAME}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _emit("ERROR", f"Simulator crashed error={exc}")
        sys.exit(1)
