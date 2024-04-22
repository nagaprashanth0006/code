import os
from configparser import ConfigParser as CP
from flask import Flask, render_template

app = Flask(__name__)
if os.path.exists()
parser1 = CP("config1.inf").items("DEFAULT")
parser2 = CP("config2.inf").items("DEFAULT")



@app.route("/")
def home_page():
    return render_template("index_page.html", env=str(os.environ))


@app.route("/health")
def health_endpoint():
    return "{'status': 'UP'}"


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8088)
