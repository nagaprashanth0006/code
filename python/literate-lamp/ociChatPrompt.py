import chromadb
from langchain_community.vectorstores import Chroma
from chromadb.config import Settings

from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationalRetrievalChain
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor
from langchain.retrievers.document_compressors import CohereRerank
import json
#from langchain_community.llms import OCIGenAI
from langchain_community.chat_models.oci_generative_ai import ChatOCIGenAI
from langchain_community.embeddings import OCIGenAIEmbeddings
from LoadProperties import LoadProperties

def create_chain():
    properties = LoadProperties()
    client = chromadb.HttpClient(host="127.0.0.1",settings=Settings(allow_reset=True))

    embeddings = OCIGenAIEmbeddings(
    model_id=properties.getEmbeddingModelName(),
    service_endpoint=properties.getEndpoint(),
    compartment_id=properties.getCompartment()
    )
    db = Chroma(client=client, embedding_function=embeddings)
    #retv = db.as_retriever(search_type="mmr", search_kwargs={"k": 7})
    retv = db.as_retriever(search_kwargs={"k": 8})

    llm = ChatOCIGenAI(
        model_id=properties.getModelName(),
        service_endpoint=properties.getEndpoint(),
        compartment_id=properties.getCompartment(),
        model_kwargs={"max_tokens":200}
        )
    memory = ConversationBufferMemory(llm=llm, memory_key="chat_history", return_messages=True, output_key='answer')

    qa = ConversationalRetrievalChain.from_llm(llm, retriever=retv , memory=memory,
                                               return_source_documents=True)
    return qa

chain = create_chain()

def chat(user_message):
    bot_json = chain.invoke({"question": user_message})
    print(bot_json)
    return {"bot_response": bot_json}

if __name__ == "__main__":
    import streamlit as st
    st.subheader("Literate-lamp Chatbot powered by OCI GenAI")
    col1 , col2 = st.columns([4,1])

    user_input = st.chat_input()
    with col1:
        col1.subheader("------Ask me anything sensible------")
        #col2.subheader("References")
        if "messages" not in st.session_state:
            st.session_state.messages = []
        if user_input:
            bot_response = chat(user_input)
            st.session_state.messages.append({"role" : "chatbot", "content" : bot_response})
            for message in st.session_state.messages:
                st.chat_message("user")
                st.write("Question: ", message['content']['bot_response']['question'])
                st.chat_message("assistant")
                st.write("Answer: ", message['content']['bot_response']['answer'])
                st.chat_message("assistant")
                for doc in message['content']['bot_response']['source_documents']:
                    st.write("Reference: ", doc.metadata['source'] + "  \n"+ "-page->"+str(doc.metadata['page']))

                    #st.write("Reference: ", doc.metadata['source'] + "  \n"+ "-page->"+str(doc.metadata['page']) +
                    #             "  \n"+ "-relevance score->"+ str(doc.metadata['relevance_score']['bq1d'])
                    #    )