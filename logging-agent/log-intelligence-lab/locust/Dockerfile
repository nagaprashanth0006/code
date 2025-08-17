FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY locustfile.py .
ENV LOCUST_HOST=http://nginx
CMD ["locust", "-f", "locustfile.py", "--host", "http://nginx", "--web-host", "0.0.0.0"]