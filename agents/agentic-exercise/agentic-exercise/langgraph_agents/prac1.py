from langgraph.graph import START, END, StateGraph, add_messages
from typing_extensions import TypedDict
from typing import Annotated, List, Dict, Any
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_ollama import ChatOllama
from langchain.tools import tool
from langchain_core.messages import SystemMessage, HumanMessage

class State(TypedDict):
    counter: int
    messages: Annotated[List, add_messages]

@tool
def double_tool(x):
    """
    Returns double of given number
    :param x:
    :return: x * 2
    """
    return x*2

@tool
def triple_tool(x):
    """
    Returns triple of given number
    :param x:
    :return: x * 3
    """
    return x*3


tools = [double_tool, triple_tool]
tool_node = ToolNode(tools)

SYSTEM = (
    "You are a precise tool-calling assistant. "
    "Always use tools for arithmetic. Output only the final number."
)

llm = ChatOllama(model="llama3.1:8b", temperature=0)
llm_with_tools = llm.bind_tools(tools)

def chatbot(state: State):
    msgs = state["messages"]
    if not msgs or msgs[0].type != "system":
        msgs = [SystemMessage(content=SYSTEM), *msgs]
    resp = llm_with_tools.invoke(msgs)
    return {"messages": [resp], "counter": state.get("counter", 0) + 1}

builder = StateGraph(State)
builder.add_node("chatbot", chatbot)
builder.add_node("tools", tool_node)

builder.add_edge(START, "chatbot")
builder.add_conditional_edges("chatbot", tools_condition, {"tools": "tools", END: END})
builder.add_edge("tools", "chatbot")

graph = builder.compile(checkpointer=MemorySaver())

config = {"configurable": {"thread_id": "t1"}}
initial = {
    "counter": 0,
    "messages": [HumanMessage(content="What is the double of 12?")]
}

for ev in graph.stream(initial, config=config, stream_mode="updates"):
    for node, delta in ev.items():
        if node in ("__start__", "__end__"): continue
        last = delta.get("messages", [None])[-1]
        role = getattr(last, "type", None)
        content = getattr(last, "content", None)
        print(f"[{node}] counter={delta.get('counter')} role={role} content={content!r}")
        print(delta)

final = graph.invoke(initial, config=config)
print("Final:", final["messages"][-1].content)
