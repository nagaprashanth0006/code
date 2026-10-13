"""Shortlist — a local resume / ATS fit checker.

    python app.py            # http://127.0.0.1:8001

Data handling: uploads are read into memory only (never spooled to disk); the parsed resume is kept in
an in-memory cache for 15 minutes so the experience slider can re-score instantly, and is dropped on
"Clear", on expiry, or when the server stops. Nothing is logged or written to disk.
"""
import datetime as dt
import gzip
import io
import logging
import os
import threading
import time

from flask import Flask, Request, jsonify, request, send_from_directory

from shortlist import score
from shortlist.extract import SUPPORTED, ExtractError, extract_document
from shortlist.knowledge import COUNTRIES, LEVEL_IDS, LEVELS, ROLES


class MemoryRequest(Request):
    """Werkzeug spools uploads over 500 KB to a temporary file; keep every upload in memory instead."""

    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return io.BytesIO()


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
HERE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)
app.request_class = MemoryRequest
app.json.sort_keys = False  # families, roles and tiers are ordered; keep the template order in the JSON
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
# Load the small embedding model in the background so startup is instant; /api/meta reports when it's ready.
threading.Thread(target=score.embedder, daemon=True).start()


@app.after_request
def no_store(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"   # results contain resume data: keep them out of the browser cache
        # A full analysis is a few hundred KB of JSON (51 roles x 5 positions); gzip shrinks it ~8x.
        if (resp.mimetype == "application/json" and not resp.direct_passthrough and "gzip" in request.headers.get("Accept-Encoding", "")
                and resp.content_length and resp.content_length > 16_000):
            resp.set_data(gzip.compress(resp.get_data(), compresslevel=5))
            resp.headers["Content-Encoding"] = "gzip"
            resp.headers["Vary"] = "Accept-Encoding"
    return resp


@app.get("/")
def index():
    return send_from_directory(os.path.join(HERE, "static"), "index.html")


@app.get("/static/<path:name>")
def static_file(name):
    return send_from_directory(os.path.join(HERE, "static"), name)


@app.get("/api/meta")
def meta():
    return jsonify(
        roles=[{"id": k, "label": v["label"], "family": v["family"]} for k, v in ROLES.items()],
        families=score.family_meta(),
        levels=[{"id": k, "label": LEVELS[k]["label"]} for k in LEVEL_IDS],
        countries=[{"id": k, "label": v["label"]} for k, v in COUNTRIES.items()],
        min_years=score.MIN_YEARS,
        formats=SUPPORTED,
        ready=score.is_ready(),
        cache_minutes=score.CACHE_TTL // 60,
    )


@app.post("/api/analyze")
def analyze():
    t0 = time.perf_counter()
    f = request.files.get("file")
    form = request.form
    filename = data = doc = None
    if f:
        filename, data = f.filename or "", f.read()
        try:
            doc = extract_document(filename, data)
        except ExtractError as e:
            return jsonify(error=str(e)), 400
        text = doc.text
        # No date inside the document: fall back to the file's last-modified time sent by the browser.
        if not (doc.modified or doc.created) and (form.get("file_modified") or "").isdigit():
            ts = dt.date.fromtimestamp(int(form["file_modified"]) / 1000)
            if dt.date(1990, 1, 1) <= ts <= dt.date.today():
                doc.modified = ts
                doc.diagnostics["date_from"] = "file timestamp"
    else:
        text = form.get("text", "")
    if len(text.split()) < 30:
        return jsonify(error="That doesn't look like a full resume — paste or upload the whole document."), 400
    years = form.get("years")
    try:
        years = float(years) if years not in (None, "", "auto") else None
    except ValueError:
        years = None
    t1 = time.perf_counter()
    result = score.analyze(text, filename=filename, data=data, years=years, jd=form.get("jd"), doc=doc)
    t2 = time.perf_counter()
    result["source"] = filename
    result["extractor"] = doc.engine if doc else "pasted text"
    result["timing_ms"] = {"read": round(1000 * (t1 - t0)), "score": round(1000 * (t2 - t1))}
    return jsonify(result)


@app.post("/api/forget")
def forget():
    """Drop a resume from the in-memory cache ("Clear" in the UI); with no key, drop everything."""
    key = (request.get_json(silent=True) or {}).get("key")
    return jsonify(forgotten=score.forget(key))


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="File is larger than 25 MB."), 413


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8001")), threaded=True)
