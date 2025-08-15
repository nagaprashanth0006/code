FROM python:3.10
WORKDIR /app
COPY load.py .
RUN pip install requests --user --no-cache-dir
CMD ["python", "load.py"]
