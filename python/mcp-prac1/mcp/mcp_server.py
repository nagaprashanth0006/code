from fastapi import FastAPI, Request
from tools.log_fetcher import fetch_logs, infer_with_ollama, daily_quote
from tools.dividends import fetch_dividend_data

tools = {
    "log_tool": fetch_logs,
    "run_inference": infer_with_ollama,
    "quote_getter": daily_quote,
    "dividend_info": fetch_dividend_data,
}

app = FastAPI()

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/call")
async def call_tool(req: Request):
    payload = await req.json()
    tool_name = payload["tool_name"]
    params = payload["params"]

    result = tools[tool_name](**params)
    return result
