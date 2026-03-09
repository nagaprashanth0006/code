import json, os, time, requests

WIKI_SSE = os.getenv("WIKI_SSE", "https://stream.wikimedia.org/v2/stream/recentchange")
LOKI_URL = os.getenv("LOKI_URL", "http://localhost:3100/loki/api/v1/push")

def now_ns():
    return str(int(time.time() * 1_000_000_000))

def push_loki(labels, line):
    payload = {"streams": [{"stream": labels, "values": [[now_ns(), line]]}]}
    requests.post(LOKI_URL, json=payload, timeout=10).raise_for_status()

def run():
    while True:
        try:
            with requests.get(
                WIKI_SSE,
                stream=True,
                headers={"Accept": "text/event-stream", "User-Agent": "lumino-wiki-ingester"},
                timeout=60,
            ) as r:
                r.raise_for_status()
                buf = []
                for raw in r.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    if raw == "":
                        frame = "\n".join(buf); buf = []
                        data_lines = [l[6:] for l in frame.split("\n") if l.startswith("data: ")]
                        if not data_lines:
                            continue
                        try:
                            evt = json.loads(data_lines[0])
                        except Exception:
                            continue
                        labels = {
                            "source": "wikipedia",
                            "wiki": str(evt.get("wiki") or "unknown"),
                            "type": str(evt.get("type") or "change"),
                            "bot": str(bool(evt.get("bot"))).lower(),
                        }
                        line = json.dumps({
                            "title": evt.get("title"),
                            "user": evt.get("user"),
                            "comment": evt.get("comment"),
                            "length": evt.get("length"),
                            "rev_id": evt.get("rev_id"),
                            "server_url": evt.get("server_url"),
                        }, ensure_ascii=False)
                        try:
                            push_loki(labels, line)
                        except Exception as e:
                            print("loki push failed:", e)
                    else:
                        buf.append(raw)
        except Exception as e:
            print("stream error:", e)
            time.sleep(3)

if __name__ == "__main__":
    run()
