"""Verity — a lightweight AI-text detector web app.

    python app.py            # http://127.0.0.1:8000
"""
import logging
import os

from flask import Flask, jsonify, request, send_from_directory

from detector.extract import SUPPORTED, ExtractError, extract
from detector.model import Detector

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
HERE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
detector = Detector()


@app.get("/")
def index():
    return send_from_directory(os.path.join(HERE, "static"), "index.html")


@app.get("/api/info")
def info():
    return jsonify(engine=detector.engine, formats=SUPPORTED)


@app.post("/api/analyze")
def analyze():
    if "file" in request.files:
        f = request.files["file"]
        try:
            text = extract(f.filename or "", f.read())
        except ExtractError as e:
            return jsonify(error=str(e)), 400
        source = f.filename
    else:
        text = (request.get_json(silent=True) or {}).get("text", "")
        source = None
    if not text.strip():
        return jsonify(error="There's no text to analyse."), 400
    result = detector.analyze(text)
    result["source"] = source
    return jsonify(result)


@app.errorhandler(413)
def too_large(_):
    return jsonify(error="File is larger than 25 MB."), 413


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")), threaded=True)
