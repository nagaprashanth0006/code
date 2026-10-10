import math
import os

from mcp.server.fastmcp import FastMCP
from tavily import TavilyClient

app = FastMCP("learning-tools-server")
tavily = TavilyClient(api_key=os.environ.get("TAVILY_API_KEY", ""))


@app.tool()
def tavily_search(query: str) -> str:
    """Search the web for current information."""
    response = tavily.search(query=query, max_results=3)
    results = response.get("results", [])
    return "\n---\n".join(
        f"Title: {r['title']}\nContent: {r['content'][:300]}" for r in results
    ) or "No results found."


@app.tool()
def calculator(expression: str) -> str:
    """Evaluate a math expression. Example: sqrt(144), pow(2,10), 3.14 * 5**2"""
    ns = {
        "__builtins__": None,
        "sqrt": math.sqrt, "pow": pow, "abs": abs,
        "round": round, "log": math.log, "pi": math.pi, "e": math.e,
    }
    result = eval(expression, ns, {})
    return f"{expression} = {result}"


if __name__ == "__main__":
    app.run()
