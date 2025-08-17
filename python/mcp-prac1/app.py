import requests
import streamlit as st
import time
import json

MCP_SERVER_URL = "http://localhost:8000/call"

st.header("Logging Agent")
default_loki_url = "http://localhost:3100"
default_query = '{stream="stdout"} != `LoadGen`' #'{app="agent"}'

query = st.text_input("Enter your query", "What all applications seem to be running in my stack as per the logs")
loki_url = st.text_input("Enter your loki url", default_loki_url)
loki_query = st.text_input("Enter your loki query", default_query)

quote = requests.post(MCP_SERVER_URL, json={"tool_name": "quote_getter", "params": {"dummy": "values"}})
st.markdown("## Quote of the day \n --- \n ##### " + quote.text)

if st.button("Analyse"):
    with st.status("Analysing"):
        st.write("Fetching logs")

        payload = {
            "tool_name": "log_tool",
            "params": {
                "loki_url": loki_url,
                "loki_query": loki_query,
                "duration": 1800,
                "limit": 500
            }
        }
        resp = requests.post(MCP_SERVER_URL, json=payload, proxies={})
        resp.raise_for_status()
        logs = [ line[1] for line in resp.json()["data"]["result"][0]["values"] ]
        st.write("Found logs. Log count:", len(logs))
        with st.expander("Logs"):
            st.code("\n".join(logs))


        prompt = (f"""
        You are a helpful and intelligent agent for log analysis.
        Analyse the given logs below and respond to the user's query.
        
        # Instructions:
        - Do not hallucinate.
        - Always ground your responses based on data.
        - Do not stop until the query is addressed correctly.
        - Ensure no preamble, no postamble.
        - Ensure the response is in relevance to user's query.
        - No generalised responses.
        - Do not respond with actions to user.
        - Understand the context and query properly before responding.
        
        # User query:
        {query}
        
        # Logs:
        {logs}
        """)

        st.write("Sending to Agent...")
        inference_payload = {
            "tool_name": "run_inference",
            "params": {
                "prompt": prompt,
                "model": "mistral"
            }
        }
    resp = requests.post(MCP_SERVER_URL, json=inference_payload, proxies={})
    resp.raise_for_status()
    agent_response = resp.json()
    st.code(agent_response, language="json")
