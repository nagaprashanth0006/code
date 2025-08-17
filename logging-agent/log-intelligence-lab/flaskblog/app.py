from flask import Flask, jsonify, request, abort
import logging, os, random, time

app = Flask(__name__)

os.makedirs("logs", exist_ok=True)
logger = logging.getLogger("flaskblog")
logger.setLevel(logging.DEBUG)
fmt = logging.Formatter('[%(asctime)s] %(levelname)s in %(module)s: %(message)s')
fh = logging.FileHandler("logs/flaskblog.log")
fh.setFormatter(fmt)
ch = logging.StreamHandler()
ch.setFormatter(fmt)
if not logger.handlers:
    logger.addHandler(fh)
    logger.addHandler(ch)

DB = {"posts": [{"id": 1, "title": "hello", "body": "world"}]}

@app.route("/posts", methods=["GET"])
def list_posts():
    logger.info("list_posts")
    time.sleep(random.uniform(0.02, 0.2))
    return jsonify(DB["posts"])

@app.route("/posts", methods=["POST"])
def create_post():
    payload = request.json or {}
    if "title" not in payload:
        logger.warning("bad request no title")
        abort(400)
    pid = max([p["id"] for p in DB["posts"]] + [0]) + 1
    post = {"id": pid, "title": payload["title"], "body": payload.get("body", "")}
    DB["posts"].append(post)
    logger.info(f"created post {pid}")
    return jsonify(post), 201

@app.route("/fail")
def fail():
    logger.error("explicit failure endpoint hit")
    abort(500)

@app.route("/health")
def health():
    return "ok", 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)