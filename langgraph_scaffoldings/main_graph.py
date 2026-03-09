## Tools imports
from langchain_core.tools import Tool, StructuredTool
from langchain_core.tools import tool

## LLM backend imports
from langchain_ollama import ChatOllama

## States and stategraphs imports
from typing import TypedDict, Annotated, Any, Optional, List, Dict

## Checkpointer
from langgraph.checkpoint.memory import MemorySaver

## Agent creation
from langgraph.prebuilt import create_react_agent

## misc
from langgraph.prebuilt import tools_condition, ToolNode
from langgraph.graph import START, END, MessagesState, StateGraph, add_messages
from requests import Session, get

## Custom imports
from vector_store_operations import ensure_vectorstore, retrieve_context

##### Globals
MODEL_NAME="mistra3.1:8b"
OLLAMA_BASE_URL="http://localhost:11434"

@tool
def check_kb(prompt, collection_name="default"):
    """
    Takes prompt and performs similarity search on the vectorstore knowledge base
    :param prompt:
    :return: list of documents matching the similarity search
    """
    vs = ensure_vectorstore(collection_name=collection_name)
    context = retrieve_context(vs, prompt)
    return context

@tool
def http_requests(url):
    """
    Takes url as input and calls it using requests.get method
    :param url:
    :return: response of the get call
    """
    session = Session()
    response = get(url, session=session)
    return response

tools = [check_kb, http_requests]

class State(TypedDict):
    messages: List[any, add_messages]

checkpointer = MemorySaver()
def chatbot(state: State) -> MessagesState:
    return {
        "messages": [llm_with_tools.invoke(state["messages"])]
    }


llm = ChatOllama(model=MODEL_NAME, base_url=OLLAMA_BASE_URL, num_ctx=4092)
llm_with_tools = llm.bind_tools(tools)
