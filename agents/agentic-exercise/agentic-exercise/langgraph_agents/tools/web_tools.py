from langchain_community.utilities import DuckDuckGoSearchAPIWrapper
from langchain_community.tools import DuckDuckGoSearchResults, DuckDuckGoSearchRun

def ddgs_tool(region="us-en", max_results=3):
    wrapper = DuckDuckGoSearchAPIWrapper(region=region, time="y", max_results=max_results)
    search = DuckDuckGoSearchResults(api_wrapper=wrapper, source="text")
    return search


