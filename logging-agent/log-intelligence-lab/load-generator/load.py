import requests, time, random

TARGET = "http://nginx:80"

while True:
    try:
        r = requests.get(TARGET)
        print(f"[LoadGen] {r.status_code}")
    except Exception as e:
        print(f"[LoadGen] error: {e}")
    time.sleep(random.uniform(0.2, 1))
