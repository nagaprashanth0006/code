from langchain_core.tools import tool
from pydantic import BaseModel, Field

from langchain_ollama import ChatOllama
#from langchain.agents import create_react_agent

from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent

from pprint import pprint
from tabulate import tabulate


@tool
def tool1():
    """Use this tool for log related queries"""
    return "Dancing dinosaur."

@tool
def tool2(param1: str, param2: str) -> str:
    """Use this tool for linux related queries"""
    return "No linux here. But received params: {param1}, {param2}".format(param1=param1, param2=param2)

class Calculator(BaseModel):
    a: int = Field(description="First number")
    b: int = Field(description="Second number")

@tool("multiplication-tool", args_schema=Calculator, return_direct=True)
def multiply(a: int, b: int) -> int:
    """Multiply two numbers"""
    return a * b


print(tool1.name)
print(tool1.description)
print(tool2.name)
print(tool2.args)
print("\n\n\n")
print("Multiplication tool - ", multiply.name)
print(multiply.invoke(
    {
        "name": "multiplication-tool",
        "args": {"a": 10, "b": 20},
        "id": "abc123",
        "type": "tool_call"
    }
).content)


########################### Agent with tools #####

tools = [tool1, tool2, multiply]
model = "llama3.1:8b-instruct-q4_K_M"
llm = ChatOllama(model=model)
memory = MemorySaver()
agent = create_react_agent(llm, tools, checkpointer=memory)

config = {
    "configurable": {
        "thread_id": "abc123"
    }
}

input_message = {
    "role": "user",
    "content": "Hi, what does the tool1 and tool2 tools say?",
}

for step in agent.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    pprint(step["messages"][-1])

