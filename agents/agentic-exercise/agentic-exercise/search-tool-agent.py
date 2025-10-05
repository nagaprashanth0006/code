from langgraph.prebuilt import create_react_agent, ToolNode
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

from langchain_ollama import ChatOllama

from langchain_core.tools import Tool
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from langchain_community.tools import DuckDuckGoSearchRun, WikipediaQueryRun

from typing import Annotated, List, Any, Dict, Optional

#%% INIT
checkpointer = MemorySaver()
llm = ChatOllama(model="llama3.1:8b-instruct-q4_K_M", temperature=0.2, num_ctx=4096)


#%% TOOLS

tools = [DuckDuckGoSearchRun()]

#%% STATE
class AgentState(StateGraph):
    message: List[str]


#%%  NODES


#%% GRAPH
graph = StateGraph()

#%% EXECUTE
