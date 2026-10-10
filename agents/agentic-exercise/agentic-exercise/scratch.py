from langchain.chat_models import init_chat_model
from langchain_ollama import ChatOllama
from langchain_tavily import TavilySearch
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import create_react_agent
from dotenv import load_dotenv
from vector_store_operations import ensure_vectorstore, retrieve_context, refresh_embeddings
import os

load_dotenv()

#vs = ensure_vectorstore("my_collection")
#refresh_embeddings("my_collection")
#os.system("ollama stop nomic-embed-text:latest")

memory = MemorySaver()
model = ChatOllama(model="llama3.1:8b-instruct-q4_K_M")
search = TavilySearch(max_results=2)

def vector_store_search(query: str) -> str:
    """
    Use this function to perform a vector store similarity search.
    Use this tool when the user query requires specific information retrieval from documents.
    
    :param query: The search query string.
    :type query: str
    :return: Description
    :rtype: str
    """
    
    vs = ensure_vectorstore("my_collection")
    response = retrieve_context(vs, query, k=4)
    return "\n".join([doc.page_content for doc in response])

tools = [search, vector_store_search]
agent_executor = create_react_agent(model, tools, checkpointer=memory)

config = {
    "configurable": {
        "thread_id": "abc123"
    }
}

input_message = {
    "role": "user",
    "content": "Hi, I'm Prashanth and I live in Bengaluru.",
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
    "content": "What is my botteicher's key as per docs?"
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



input_message = {
    "role": "user",
    "content": "How to defeat Rogue mega absol in legends Z-A, what is the best pokemon for this battle"
}

for step in agent_executor.stream(
        {"messages": [input_message]}, config, stream_mode="values"
):
    step["messages"][-1].pretty_print()
