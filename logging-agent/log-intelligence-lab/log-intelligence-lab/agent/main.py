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
