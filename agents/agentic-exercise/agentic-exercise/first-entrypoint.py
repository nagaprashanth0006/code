from typing import Dict, Any, Union, List
from langchain_ollama.chat_models import ChatOllama
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent

@tool
def calc(expression: str) -> str:
    """Safely evaluate a basic arithmetic expression like '2 + 2*10'."""
    allowed = {"+", "-", "*", "/", "(", ")", " ", ".", "0","1","2","3","4","5","6","7","8","9"}
    if not set(expression).issubset(allowed):
        return "Only basic numbers and + - * / ( ) are allowed."
    try:
        return str(eval(expression))
    except Exception as e:
        return f"Error: {e}"

LOCAL_KB: Dict[str, str] = {
    "uim": "Oracle UIM is an inventory management system used in OSS for telecom.",
    "logsphere": "LogSphere is our local log-intelligence project with RAG + agents.",
}

@tool
def kb_lookup(query: str) -> str:
    """Lookup short facts from a tiny local key-value store."""
    q = query.lower().strip()
    for k, v in LOCAL_KB.items():
        if k in q:
            return v
    return "No local fact found. Add more entries to LOCAL_KB."

from langchain_experimental.tools.python.tool import PythonREPLTool
py_repl = PythonREPLTool()

tools = [calc, kb_lookup, py_repl]

model = ChatOllama(model="llama3")

agent = create_react_agent(model, tools)

messages: List[Dict[str, Union[str, List[Dict[str, str]]]]] = [
    {"role": "user", "content": "Compute 12*(7-3), then tell me one fact about UIM."}
]
result = agent.invoke({"messages": messages})
print(result["messages"][-1].content)
