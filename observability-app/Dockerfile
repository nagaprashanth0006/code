# docker build --no-cache -t observability-app:latest .
# docker tag observability-app localhost:5000/observability-app:latest

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py app.py
RUN mkdir /app/logs && ls -ltrh
EXPOSE 8000
CMD ["python", "app.py"]