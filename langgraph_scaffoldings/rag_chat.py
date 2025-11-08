from langchain_ollama import ChatOllama
from vector_store_operations import ensure_vectorstore, retrieve_context
from pprint import pprint

## Globals
# LLM_MODEL = "llama3.1:8b-instruct-q4_K_M"
LLM_MODEL = "phi3:mini"
MODEL_CONTEXT = 4092

def create_chatbot():
    chatbot = ChatOllama(
        model=LLM_MODEL,
        num_ctx=MODEL_CONTEXT,
        temperature=0.3,
    )
    return chatbot

def rag_response(prompt, collection_name="documentation", uploaded_file=None):
    system_message = ("""You are a helpful RAG agent. You have access to Documentation pertaining to linux and IT systems in particular."
            Ensure your responses abide by the following rules:
            - never hallucinate
            - always ground your answer based on knowledge or context from RAG
            - if you don't have a grounded answer, let the user know the same
            - always be clear, crisp and empathetic
            - Do not suggest the user check for themselves if info was not sufficient
            - Do not say "I think", "confidently say" or any such filler words. Be crisp to the point.

            Context from vectorstore:
            {context}

            User query:
            {prompt} 
          """)

    llm = create_chatbot()
    # vectorstore = ensure_vectorstore(collection_name)
    # context = retrieve_context(vectorstore, prompt, k=3)
    # print("Obtained context:", context)
    # print("Collection name:", collection_name)
    # print("Prompt:", prompt)
    #uploaded_file.seek(0)
    text = uploaded_file.read().decode("utf-8", errors="ignore")
    context = text
    response = llm.invoke(
        system_message.format(context=context, prompt=prompt)
    )
    return response.content

if __name__ == "__main__":
    query = "What is name of frontend project"
    response = rag_response(query)
    print(response.content)