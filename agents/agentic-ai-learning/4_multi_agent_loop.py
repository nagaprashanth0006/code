import asyncio
import sys

import ollama
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

MODEL = "llama3.2"
MAX_ITERATIONS = 3
PASS_SCORE = 7

SYSTEMS = {
    "research": "You are a research specialist. Use tavily_search.",
    "math": "You are a math specialist. Use the calculator.",
    "general": "You are a helpful assistant.",
}


def ask(prompt):
    return ollama.chat(model=MODEL, messages=[{"role": "user", "content": prompt}]).message.content


def understand(query):
    return ask(
        f"List the key things needed to answer this query. Be brief.\nQuery: {query}"
    )


def plan(understanding):
    raw = ask(
        f"Create 2-3 tasks to gather this information.\n"
        f"Format: AGENT: task  (AGENT = RESEARCH, MATH, or GENERAL)\n\n{understanding}"
    )
    tasks = []
    for line in raw.strip().splitlines():
        if ":" in line:
            agent, task = line.split(":", 1)
            agent = agent.strip().lower().lstrip("0123456789.- ")
            if agent in SYSTEMS:
                tasks.append({"agent": agent, "task": task.strip()})
    return tasks


def route(agent):
    return agent if agent in SYSTEMS else "general"


async def execute(task, tools, session):
    messages = [
        {"role": "system", "content": SYSTEMS[route(task["agent"])]},
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


def summarize(query, results):
    context = "\n\n".join(f"[{r['agent']}]: {r['result']}" for r in results)
    return ask(f"Write a complete answer to: {query}\n\nBased on:\n{context}")


def evaluate(query, answer):
    raw = ask(
        f"Score this answer 1-10. Reply with ONLY a number.\n"
        f"Query: {query}\nAnswer: {answer[:600]}"
    )
    for word in raw.split():
        clean = word.strip(".,")
        if clean.isdigit():
            return int(clean)
    return 5


async def run_loop(query, tools, session):
    feedback = None

    for i in range(1, MAX_ITERATIONS + 1):
        print(f"\nIteration {i}/{MAX_ITERATIONS}")

        current = query if not feedback else f"{query}\n\nPrevious feedback: {feedback}"

        print("  [Understand]")
        understanding = understand(current)

        print("  [Plan]")
        tasks = plan(understanding)
        for t in tasks:
            print(f"    [{t['agent']}] {t['task']}")

        print("  [Route + Execute]")
        results = []
        for task in tasks:
            print(f"    {task['agent']} agent...")
            result = await execute(task, tools, session)
            results.append({**task, "result": result})

        print("  [Summarize]")
        answer = summarize(query, results)

        print("  [Evaluate]")
        score = evaluate(query, answer)
        print(f"    Score: {score}/10")

        if score >= PASS_SCORE:
            print(f"  Satisfied after {i} iteration(s).")
            return answer

        feedback = ask(
            f"What is missing from this answer? Be specific.\n"
            f"Query: {query}\nAnswer: {answer[:400]}"
        )
        print(f"  Feedback: {feedback[:150]}")

    return answer


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
                "What are the main barriers to renewable energy adoption, "
                "and if solar efficiency is 22% today and improves by 3 points per year, "
                "what will it be in 5 years?"
            )
            print(f"Query: {query}")

            final = await run_loop(query, tools, session)
            print(f"\nFinal Answer:\n{final}")


if __name__ == "__main__":
    asyncio.run(main())
