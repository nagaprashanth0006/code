#!/bin/bash

set -e

BASE_DIR="log-intelligence-lab"
mkdir -p $BASE_DIR

echo "[INFO] Creating directory structure..."
mkdir -p $BASE_DIR/{nginx,tomcat/webapps,redis,mysql,promtail,loki,agent/utils,load-generator}

########################################
# Docker Compose
########################################
cat > $BASE_DIR/docker-compose.yml <<'EOF'
version: '3.9'

services:
  nginx:
    build: ./nginx
    ports:
      - "8080:80"
    depends_on:
      - tomcat
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro

  tomcat:
    build: ./tomcat
    environment:
      - JAVA_OPTS=-Djava.util.logging.config.file=/usr/local/tomcat/logging.properties
    volumes:
      - ./tomcat/webapps:/usr/local/tomcat/webapps

  redis:
    image: redis:6
    volumes:
      - ./redis/redis.conf:/usr/local/etc/redis/redis.conf

  mysql:
    image: mysql:8
    environment:
      - MYSQL_ROOT_PASSWORD=root
      - MYSQL_DATABASE=sampledb
    volumes:
      - ./mysql/init.sql:/docker-entrypoint-initdb.d/init.sql

  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki/config.yml:/etc/loki/config.yml

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - ./promtail/promtail-config.yml:/etc/promtail/config.yml
      - /var/log:/var/log:ro
    command: -config.file=/etc/promtail/config.yml

  agent:
    build: ./agent
    depends_on:
      - loki
      - promtail
    ports:
      - "5050:5000"
    volumes:
      - ./agent:/app
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/summary"]
      interval: 10s
      timeout: 5s
      retries: 5

  loadgen:
    build: ./load-generator
    depends_on:
      - nginx
EOF

########################################
# NGINX
########################################
cat > $BASE_DIR/nginx/Dockerfile <<'EOF'
FROM nginx:1.21
COPY nginx.conf /etc/nginx/nginx.conf
EOF

rm -f $BASE_DIR/nginx/nginx.conf
cat > $BASE_DIR/nginx/nginx.conf <<'EOF'
events {}

http {
  map $http_x_request_id $reqid {
    "" $request_id;
    default $http_x_request_id;
  }

  log_format main '$remote_addr - $reqid [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"';
  access_log /var/log/nginx/access.log main;
  error_log /var/log/nginx/error.log warn;

  server {
    listen 80;

    location / {
      add_header X-Request-ID $reqid;
      proxy_set_header X-Request-ID $reqid;
      proxy_pass http://tomcat:8080/;
    }
  }
}
EOF

echo "[INFO] NGINX configuration created."
########################################
# Tomcat
########################################
cat > $BASE_DIR/tomcat/Dockerfile <<'EOF'
FROM tomcat:9.0
COPY logging.properties /usr/local/tomcat/logging.properties
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -L -o /usr/local/tomcat/webapps/petclinic.war https://github.com/spring-projects/spring-petclinic/releases/latest/download/spring-petclinic.war
EOF

cat > $BASE_DIR/tomcat/logging.properties <<'EOF'
.handlers = java.util.logging.ConsoleHandler
java.util.logging.ConsoleHandler.level = FINE
EOF

########################################
# Redis
########################################
cat > $BASE_DIR/redis/redis.conf <<'EOF'
save 60 1
EOF

########################################
# MySQL
########################################
cat > $BASE_DIR/mysql/init.sql <<'EOF'
CREATE TABLE IF NOT EXISTS orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders (description) VALUES ('Sample order 1'), ('Sample order 2');
EOF

########################################
# Loki & Promtail
########################################
cat > $BASE_DIR/loki/config.yml <<'EOF'
auth_enabled: false
server:
  http_listen_port: 3100
ingester:
  lifecycler:
    address: 127.0.0.1
  chunk_idle_period: 1h
  max_chunk_age: 1h
schema_config:
  configs:
    - from: 2023-01-01
      store: boltdb
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h
EOF

cat > $BASE_DIR/promtail/promtail-config.yml <<'EOF'
server:
  http_listen_port: 9080
positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: system
    static_configs:
      - targets:
          - localhost
        labels:
          job: containerlogs
          __path__: /var/lib/docker/containers/*/*.log
EOF

########################################
# Agent (MVP)
########################################
cat > $BASE_DIR/agent/Dockerfile <<'EOF'
FROM python:3.10
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
ENV FLASK_APP=main
CMD ["flask", "--app=main", "run", "--host=0.0.0.0", "--port=5000"]
EOF

cat > $BASE_DIR/agent/requirements.txt <<'EOF'
requests
flask
fuzzywuzzy
python-Levenshtein
EOF

cat > $BASE_DIR/agent/main.py <<'EOF'
from flask import Flask, jsonify
from utils.correlation import analyze_logs
import logging

app = Flask(__name__)

@app.route('/summary')
def summary():
    # Demo summary
    data = analyze_logs()
    return jsonify(data)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logging.info("Starting Flask app on 0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000)
EOF

cat > $BASE_DIR/agent/utils/correlation.py <<'EOF'
def analyze_logs():
    # Placeholder: fake root cause analysis. Overridden by real function at later stage in this script.
    return {
        "root_cause": "Redis timeout",
        "affected_services": ["Tomcat", "NGINX"],
        "sample_request_id": "xyz789"
    }
EOF

########################################
# Load Generator
########################################
rm -f $BASE_DIR/load-generator/Dockerfile
rm -f $BASE_DIR/load-generator/load.py
cat > $BASE_DIR/load-generator/Dockerfile <<'EOF'
FROM python:3.10
WORKDIR /app
COPY load.py .
RUN pip install requests --user --no-cache-dir
CMD ["python", "load.py"]
EOF

cat > $BASE_DIR/load-generator/load.py <<'EOF'
import requests, time, random

TARGET = "http://nginx:80"

while True:
    try:
        r = requests.get(TARGET)
        print(f"[LoadGen] {r.status_code}")
    except Exception as e:
        print(f"[LoadGen] error: {e}")
    time.sleep(random.uniform(0.2, 1))
EOF

cat > $BASE_DIR/agent/utils/correlation.py <<'EOF'
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
EOF

cat > $BASE_DIR/agent/test_loki_correlation.py <<'EOF'
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
EOF

echo "[INFO] Bootstrap completed. Run 'cd $BASE_DIR && docker-compose up --build'."