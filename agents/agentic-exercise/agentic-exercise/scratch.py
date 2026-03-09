from langchain.chat_models import init_chat_model
from langchain_ollama import ChatOllama
from langchain_tavily import TavilySearch
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent
from dotenv import load_dotenv

load_dotenv()

memory = MemorySaver()
model = ChatOllama(model="llama3.1:8b-instruct-q4_K_M")
search = TavilySearch(max_results=2)
tools = [search]
agent_executor = create_react_agent(model, tools, checkpointer=memory)

config = {
    "configurable": {
        "thread_id": "abc123"
    }
}

input_message = {
    "role": "user",
    "content": "Hi, I'm Bob and I live in SF.",
}

for step in agent_executor.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    step["messages"][-1].pretty_print()

input_message = {
    "role": "user",
    "content": "What is the weather where I currently live?"
}

for step in agent_executor.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    step["messages"][-1].pretty_print()

input_message = {
    "role": "user",
    "content": "How cool or hot is it compared with Bengaluru's weather?"
}

for step in agent_executor.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    step["messages"][-1].pretty_print()

input_message = {
    "role": "user",
    "content": "How to defeat a 6-star tera raid Annihilape that has water-tera type with my Annihilape with 'Vital spirit' ability?"
}

for step in agent_executor.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    step["messages"][-1].pretty_print()