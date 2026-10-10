import asyncio
import sys

import ollama
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MODEL = "llama3.2"

SYSTEMS = {
    "research": "You are a research specialist. Use tavily_search to find information.",
    "math": "You are a math specialist. Use the calculator for all computations.",
    "general": "You are a helpful assistant. Answer from your knowledge.",
}


def route(query):
    response = ollama.chat(model=MODEL, messages=[{
        "role": "user",
        "content": f"Reply with ONE word only: 'research', 'math', or 'general'.\nQuery: {query}",
    }])
    word = response.message.content.strip().lower()
    for agent in SYSTEMS:
        if agent in word:
            return agent
    return "general"


async def run_specialist(query, agent, tools, session):
    messages = [
        {"role": "system", "content": SYSTEMS[agent]},
        {"role": "user", "content": query},
    ]
    while True:
        response = ollama.chat(model=MODEL, messages=messages, tools=tools)
        messages.append(response.message)

        if not response.message.tool_calls:
            return response.message.content

        for call in response.message.tool_calls:
            result = await session.call_tool(call.function.name, dict(call.function.arguments))
            messages.append({"role": "tool", "content": result.content[0].text})


async def main():
    server_params = StdioServerParameters(command=sys.executable, args=["mcp_server.py"])

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            mcp_tools = (await session.list_tools()).tools
            tools = [{"type": "function", "function": {
                "name": t.name, "description": t.description, "parameters": t.inputSchema,
            }} for t in mcp_tools]

            queries = [
                "What are the latest fusion energy breakthroughs?",
                "What is compound interest on $10000 at 5% for 10 years? Use: 10000 * pow(1.05, 10)",
                "What is the capital of Australia?",
            ]

            for query in queries:
                agent = route(query)
                print(f"Query: {query}\nRouter -> {agent}")
                answer = await run_specialist(query, agent, tools, session)
                print(f"Answer: {answer[:300]}\n")


if __name__ == "__main__":
    asyncio.run(main())
