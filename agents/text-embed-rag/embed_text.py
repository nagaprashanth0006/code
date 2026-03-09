# pip install: langchain>=0.2 langchain-community>=0.2 langchain-experimental chromadb

from langchain_community.document_loaders import TextLoader
from langchain_experimental.text_splitter import SemanticChunker
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_community.llms import Ollama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda, RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

EMBEDDING_MODEL = "nomic-embed-text"
LANGUAGE_MODEL = "mistral"

def generate_embeddings():
    docs = TextLoader("data/customdata1.txt", encoding="utf-8").load()
    embedder = OllamaEmbeddings(model=EMBEDDING_MODEL)

    splits = SemanticChunker(embedder).split_documents(docs)

    vectordb = Chroma.from_documents(
        documents=splits,
        embedding=embedder,
        persist_directory="chroma_db",
        collection_name="exp1",  # change if you change EMBEDDING_MODEL
        collection_metadata={"hnsw:space": "cosine"},
    )
    vectordb.persist()
    print("Persisted docs:", vectordb._collection.count())
    return vectordb

vectordb = generate_embeddings()
retriever = vectordb.as_retriever(search_kwargs={"k": 2})

prompt = ChatPromptTemplate.from_template(
    "Use the context to answer the question.\n\nContext:\n{context}\n\nQuestion:\n{question}"
)

def format_docs(docs):
    return "\n\n".join(d.page_content for d in docs)

chain = (
    {
        "context": retriever | RunnableLambda(format_docs),
        "question": RunnablePassthrough(),
    }
    | prompt
    | Ollama(model=LANGUAGE_MODEL)
    | StrOutputParser()
)

question = "What are the credentials mentioned for the frontend project in customdata1.txt file?"
answer = chain.invoke(question)
print(answer)


"""
# Data + ML Algo + Feature Engineering + Frameworks = Model
# Data + Transformer algo + fine-tuning = LLM
# LLM + prompt = Generative AI
# LLM + Custom data + prompt = RAG
"""