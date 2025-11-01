#%%
from lib2to3.fixes.fix_input import context

from langgraph.prebuilt import tools_condition, ToolNode
from langgraph.graph import START, END, MessagesState, StateGraph, add_messages
from langchain_ollama import ChatOllama
from langgraph.checkpoint.memory import MemorySaver
from typing import Annotated, List, Literal, TypedDict
from langchain_core.tools import tool

from dotenv import load_dotenv

load_dotenv()

#%% md
# # Define State
#%%
class State(TypedDict):
    messages: Annotated[List, add_messages]
#%% md
# # Define Tools
#%%
@tool
def get_stock_price(symbol: str) -> float:
    """Return the current price of a stock given the stock symbol
    :param symbol: stock symbol
    :return: current price of the stock"""
    return {
        "MSFT": 200.3,
        "AAPL": 100.4,
        "AMZN": 150.0,
        "RIL": 87.6
    }.get(symbol, 0.0)

tools = [get_stock_price]

#%% md
# # Initialize llm and bind tools
#%%
llm = ChatOllama(model = "llama3.1:8b-instruct-q4_k_m", num_ctx=4096)
llm_with_tools = llm.bind_tools(tools)
#%% md
# # Setup Memory
#%%
memory = MemorySaver()
#%% md
# # Setup Graph and create nodes, edges
#%%
def chatbot(state: State) -> MessagesState:
    return {
        "messages": [llm_with_tools.invoke(state["messages"])]
    }

builder = StateGraph(State)

builder.add_node(chatbot)
builder.add_node("tools", ToolNode(tools))

builder.add_edge(START, "chatbot")
builder.add_conditional_edges("chatbot", tools_condition)
builder.add_edge("tools", "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile(checkpointer=memory)

#%%
config1 = {
    "configurable": {
        "thread_id": "1"
    }
}

prompt = "I want to buy 20 AMZN stocks using current price. Then 15 MSFT. What will be the total cost in Indian Rupees? Output only the total cost"
state = graph.invoke(
    {
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    },
    config=config1
)
print(state["messages"][-1].content)
