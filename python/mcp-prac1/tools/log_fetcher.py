import requests
import time
from langchain_ollama import OllamaLLM

def infer_with_ollama(prompt, model="mistral"):
    OLLAMA_ENDPOINT = "http://localhost:11434/api/generate"
    response = requests.post(OLLAMA_ENDPOINT, json={"prompt": prompt, "model": model, "stream": False}, proxies={})
    response.raise_for_status()
    result = response.json()["response"]
    return result

def daily_quote(dummy):
    llm = OllamaLLM(model="mistral", temperature=0.9, top_k=3)
    response = llm.invoke("Tell me a motivational quote")
    return response

def fetch_logs(loki_url, loki_query, duration: int = 1800, limit: int = 200):
    start = int(time.time() * 1e9 - duration * 1e9)
    end = int(time.time() * 1e9)
    url = f"{loki_url}/loki/api/v1/query_range"

    #?query={loki_query}&start={start}&end={end}&limit=200

    params = {
        "query": loki_query,
        "start": start,
        "end": end,
        "limit": limit,
    }
    response = requests.get(url, params=params, proxies={})
    response.raise_for_status()
    logs = response.json()
    print(logs)
    return logs
