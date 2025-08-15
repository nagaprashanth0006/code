import requests
import re
from datetime import datetime, timedelta

LOKI_URL = "http://loki:3100/loki/api/v1/query_range"

def analyze_logs():
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(minutes=2)

    params = {
        "query": '{job=~"nginx|tomcat|redis|mysql"}',
        "start": int(start_time.timestamp() * 1e9),
        "end": int(end_time.timestamp() * 1e9),
        "limit": 1000
    }

    resp = requests.get(LOKI_URL, params=params)
    resp.raise_for_status()
    data = resp.json()

    error_pattern = re.compile(r"(ERROR|Exception|timeout|connection refused|5\d{2})", re.IGNORECASE)
    reqid_pattern = re.compile(r"\b[0-9a-f]{6,}\b", re.IGNORECASE)

    requests_map = {}
    for stream in data.get("data", {}).get("result", []):
        service = stream["stream"].get("job", "unknown")
        for entry in stream["values"]:
            ts, log_line = entry
            ts_dt = datetime.utcfromtimestamp(int(ts) / 1e9)

            reqid_match = reqid_pattern.search(log_line)
            reqid = reqid_match.group(0) if reqid_match else f"{service}:{ts}"

            if reqid not in requests_map:
                requests_map[reqid] = []

            requests_map[reqid].append({
                "service": service,
                "timestamp": ts_dt,
                "message": log_line.strip(),
                "is_error": bool(error_pattern.search(log_line))
            })

    # Pick first request ID with an error
    for reqid, logs in requests_map.items():
        logs_sorted = sorted(logs, key=lambda x: x["timestamp"])
        root_cause_log = next((l for l in logs_sorted if l["is_error"]), None)

        if root_cause_log:
            affected = {log["service"] for log in logs_sorted}
            return {
                "request_id": reqid,
                "root_cause": root_cause_log["message"],
                "affected_services": list(affected),
                "error_count": sum(1 for l in logs_sorted if l["is_error"])
            }

    return {"message": "No errors detected in the last 2 minutes"}
