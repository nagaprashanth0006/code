FROM python:3.13-slim

WORKDIR /app
COPY *.py /app
COPY requirements.txt /tmp
RUN pip install -r /tmp/requirements.txt && pip cache purge
ENV PYTHONPATH=/app

EXPOSE 8501
ENTRYPOINT ["streamlit", "run", "/app/streamlit_app.py"]
