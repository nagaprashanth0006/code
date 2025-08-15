import requests
import re
from datetime import datetime, timedelta

LOKI_URL = "http://loki:3100/loki/api/v1/query_range"

def query_loki():
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(minutes=2)

    params = {
        "query": '{job=~"nginx|tomcat|redis|mysql"}',
        "start": int(start_time.timestamp() * 1e9),
        "end": int(end_time.timestamp() * 1e9),
        "limit": 5000
    }

    print(f"[INFO] Querying Loki for logs between {start_time} and {end_time}...")
    resp = requests.get(LOKI_URL, params=params)
    resp.raise_for_status()
    return resp.json()

def analyze_loki_data(data):
    requests_map = {}
    error_pattern = re.compile(r"(ERROR|Exception|timeout|connection refused|5\d{2})", re.IGNORECASE)
    reqid_pattern = re.compile(r"\b[0-9a-f]{6,}\b", re.IGNORECASE)

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

    for reqid, logs in requests_map.items():
        logs_sorted = sorted(logs, key=lambda x: x["timestamp"])
        root_cause_log = next((l for l in logs_sorted if l["is_error"]), None)

        if root_cause_log:
            affected = {log["service"] for log in logs_sorted}
            print(f"\n[Request: {reqid}] Root Cause: {root_cause_log['message']}")
            print(f"Affected Services: {', '.join(affected)}")
            print(f"Total logs: {len(logs_sorted)}")

if __name__ == "__main__":
    data = query_loki()
    analyze_loki_data(data)
