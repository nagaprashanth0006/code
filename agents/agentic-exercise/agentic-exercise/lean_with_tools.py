from typing import TypedDict, Annotated, List, Optional, Any
from langchain.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph.message import add_messages
from langchain_ollama import ChatOllama
from langchain.tools import tool
from langgraph.graph import StateGraph, END

class AgentState(TypedDict):
    messages: Annotated[List[Any], add_messages]

def tool1(input_text: str) -> str:
    """
    Docstring for tool1
    
    :param input_text: Description
    :type input_text: str
    :return: Description
    :rtype: str
    """
    return f"Tool1 received: {input_text}. Output if foobar"

tools = [tool1]
llm = ChatOllama(model="llama3.1:8b-instruct-q4_K_M", base_url="http://localhost:11434")
llm_with_tools = llm.bind_tools(tools)

tool_node = ToolNode(tools)

def call_agent(state: AgentState):
    messages = state["messages"]
    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}


def should_continue(state: AgentState) -> str:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "end"

workflow = StateGraph(AgentState)
workflow.add_node("agent", call_agent)
workflow.add_node("tools", tool_node)

workflow.set_entry_point("agent")

workflow.add_conditional_edges(
    "agent",
    should_continue,
    {"tools": "tools", "end": END}
)
workflow.add_edge("tools", "agent")

app = workflow.compile()

def run_agent(query: str):
    """Run the agent with a given query."""
    initial_state = {
        "messages": [HumanMessage(content=query)]
    }
    
    result = app.invoke(initial_state)
    return result["messages"][-1].content

if __name__ == "__main__":
    # Test the agent
    queries = [
        "What's the weather like in New York?",
        "Calculate the sum of 10, 25, and 37",
        "Search Wikipedia for information about artificial intelligence"
    ]
    
    for query in queries:
        print(f"Query: {query}")
        print(f"Response: {run_agent(query)}")
        print("-" * 50)