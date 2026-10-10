import asyncio
import sys

import ollama
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MODEL = "llama3.2"


def mcp_to_ollama(tool):
    return {"type": "function", "function": {
        "name": tool.name,
        "description": tool.description or "",
        "parameters": tool.inputSchema,
    }}


async def run_agent(query, tools, session):
    messages = [{"role": "user", "content": query}]

    while True:
        response = ollama.chat(model=MODEL, messages=messages, tools=tools)
        messages.append(response.message)

        if not response.message.tool_calls:
            return response.message.content

        for call in response.message.tool_calls:
            print(f"  Tool: {call.function.name}({call.function.arguments})")
            result = await session.call_tool(call.function.name, dict(call.function.arguments))
            messages.append({"role": "tool", "content": result.content[0].text})


async def main():
    server_params = StdioServerParameters(command=sys.executable, args=["mcp_server.py"])

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            mcp_tools = (await session.list_tools()).tools
            print("Tools from MCP server:", [t.name for t in mcp_tools])

            tools = [mcp_to_ollama(t) for t in mcp_tools]

            query = "What is 1337 * 42? Also search for news about AI agents."
            print(f"\nQuery: {query}")
            answer = await run_agent(query, tools, session)
            print(f"\nAnswer: {answer}")


if __name__ == "__main__":
    asyncio.run(main())
