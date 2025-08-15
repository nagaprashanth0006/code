FROM python:3.10
WORKDIR /app
COPY load.py .
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN mkdir -p /app/logs
CMD ["python", "load.py"]
