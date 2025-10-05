from typing import Any, List, Dict, Optional
from typing_extensions import TypedDict
import os, time

from langchain_core.tools import tool
from langchain_ollama import ChatOllama

from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver


os.environ.pop("HTTP_PROXY", None)
os.environ.pop("HTTPS_PROXY", None)
os.environ["NO_PROXY"] = "127.0.0.1,localhost,::1"
os.environ["no_proxy"] = "127.0.0.1,localhost,::1"

class AgentState(TypedDict, total=False):
    input: str
    messages: List[Any]
    outcome: Optional[str]

@tool
def multiply(a: int, b: int) -> int:
    """Takes two numbers a, b and returns their product"""
    return a * b

@tool
def grep(text: str, needle: str) -> Dict[str, Any]:
    """Takes a text and pattern and returns the count of matching lines and matching lines where the patten is matched"""
    lines = text.splitlines()
    hits = [i for i, ln in enumerate(lines, 1) if needle in ln]
    return {"count": len(hits), "lines": hits}

def build_llm(model_name: str):
    llm = ChatOllama(
        model=model_name,
        base_url="http://127.0.0.1:11434",
        streaming=False,
        timeout=120,
        num_ctx=2048,
        keep_alive="5m"
    )
    llm.streaming = False
    return llm

def build_agent(model_name: str, tools: List[Any]):
    llm = build_llm(model_name)
    try:
        _ = llm.invoke("hi")
    except Exception:
        pass
    memory = MemorySaver()
    return create_react_agent(llm, tools, checkpointer=memory)

def run_agent_once(agent, user_prompt: str) -> Dict[str, Any]:
    cfg = {"configurable": {"thread_id": "abc123"}}
    err = None
    for _ in range(2):
        try:
            return agent.invoke({"input": user_prompt}, config=cfg)
        except ValueError as e:
            if "No data received from Ollama stream" not in str(e):
                raise
            err = e
            time.sleep(0.6)
    if err:
        raise err

tools = [multiply, grep]
agent = build_agent("llama3.1:8b-instruct-q4_K_M", tools)
result = run_agent_once(agent, "What is 3 multiplied by 6?")
print(result.get("output", result))
