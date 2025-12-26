from langchain.tools import tool

@tool
def double_tool(x):
    """
    Returns double of given number
    :param x:
    :return: x * 2
    """
    return x*2

@tool
def triple_tool(x):
    """
    Returns triple of given number
    :param x:
    :return: x * 3
    """
    return x*3

@tool
def should_exit(state: State) -> bool:
    """
    Tells whether to exit based on given state
    :param state:
    :return: bool
    """
    return state["counter"] >= 5