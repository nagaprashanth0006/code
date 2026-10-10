import asyncio
import sys

import ollama
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MODEL = "llama3.2"

SYSTEMS = {
    "research": "You are a research specialist. Use tavily_search.",
    "math": "You are a math specialist. Use the calculator.",
    "general": "You are a helpful assistant.",
}


def plan(query):
    response = ollama.chat(model=MODEL, messages=[{"role": "user", "content": (
        f"Break this into 2-3 independent tasks.\n"
        f"Format each line as: AGENT: task  (AGENT = RESEARCH, MATH, or GENERAL)\n"
        f"Query: {query}"
    )}])
    tasks = []
    for line in response.message.content.strip().splitlines():
        if ":" in line:
            agent, task = line.split(":", 1)
            agent = agent.strip().lower().lstrip("0123456789.- ")
            if agent in SYSTEMS:
                tasks.append({"agent": agent, "task": task.strip()})
    return tasks


async def run_task(task, tools, session):
    messages = [
        {"role": "system", "content": SYSTEMS[task["agent"]]},
        {"role": "user", "content": task["task"]},
    ]
    while True:
        response = ollama.chat(model=MODEL, messages=messages, tools=tools)
        messages.append(response.message)

        if not response.message.tool_calls:
            return response.message.content

        for call in response.message.tool_calls:
            result = await session.call_tool(call.function.name, dict(call.function.arguments))
            messages.append({"role": "tool", "content": result.content[0].text})


def synthesize(query, results):
    context = "\n\n".join(f"[{r['agent']}]: {r['result']}" for r in results)
    response = ollama.chat(model=MODEL, messages=[{"role": "user", "content": (
        f"Combine these agent results into one coherent answer.\n"
        f"Original query: {query}\n\nResults:\n{context}"
    )}])
    return response.message.content


async def main():
    server_params = StdioServerParameters(command=sys.executable, args=["mcp_server.py"])

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            mcp_tools = (await session.list_tools()).tools
            tools = [{"type": "function", "function": {
                "name": t.name, "description": t.description, "parameters": t.inputSchema,
            }} for t in mcp_tools]

            query = (
                "Research current EV adoption trends, and calculate: "
                "if there are 26 million EVs today growing at 25% per year, "
                "how many in 5 years? Use: round(26 * pow(1.25, 5), 1)"
            )
            print(f"Query: {query}\n")

            tasks = plan(query)
            print("Plan:")
            for t in tasks:
                print(f"  [{t['agent']}] {t['task']}")

            print("\nRunning tasks...")
            results = []
            for task in tasks:
                print(f"  {task['agent']} agent working...")
                result = await run_task(task, tools, session)
                results.append({**task, "result": result})

            print("\nSynthesizing...")
            final = synthesize(query, results)
            print(f"\nFinal Answer:\n{final}")


if __name__ == "__main__":
    asyncio.run(main())
