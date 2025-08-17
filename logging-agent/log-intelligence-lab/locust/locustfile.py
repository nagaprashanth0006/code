from locust import HttpUser, task, between
import random

class WebUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task(4)
    def fastapi_work(self):
        n = random.randint(1, 100)
        self.client.get(f"/api/fast/work/{n}")

    @task(2)
    def fastapi_ping(self):
        self.client.get("/api/fast/ping")

    @task(3)
    def flask_list(self):
        self.client.get("/api/blog/posts")

    @task(1)
    def flask_create(self):
        self.client.post("/api/blog/posts", json={"title": f"title-{random.randint(1,9999)}"})