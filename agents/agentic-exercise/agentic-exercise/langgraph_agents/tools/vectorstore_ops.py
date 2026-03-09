import os
os.environ["PYTHONWARNINGS"] = "ignore::urllib3.exceptions.NotOpenSSLWarning"
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ["CHROMA_TELEMETRY"] = "False"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

import hashlib
import warnings
warnings.filterwarnings("ignore", category=Warning, module="urllib3")

from typing import Optional
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader, PyMuPDFLoader, WebBaseLoader
import chromadb
from langchain_chroma import Chroma
from langchain_ollama import OllamaEmbeddings

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(BASE_DIR, "..", "data")))
CHROMA_PERSIST_DIR = os.path.abspath(os.path.join(DATA_DIR, "chroma_db"))

DEFAULT_COLLECTION = "text-rag"
EMBEDDING_MODEL = "nomic-embed-text"
LANGUAGE_MODEL = "mistral"

def sid(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()

def ensure_vectorstore(collection: Optional[str] = None):
    os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
    try:
        os.chmod(CHROMA_PERSIST_DIR, 0o755)
    except Exception:
        pass
    embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)
    return Chroma(
        collection_name=(collection or DEFAULT_COLLECTION),
        embedding_function=embeddings,
        persist_directory=CHROMA_PERSIST_DIR,
    )

def generate_embeddings(vectorstore, reset=False):
    if reset and os.path.isdir(CHROMA_PERSIST_DIR):
        import shutil
        shutil.rmtree(CHROMA_PERSIST_DIR, ignore_errors=True)
        os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
        try:
            os.chmod(CHROMA_PERSIST_DIR, 0o755)
        except Exception:
            pass
        vectorstore = ensure_vectorstore(collection=getattr(vectorstore, "collection_name", DEFAULT_COLLECTION))
    try:
        if getattr(vectorstore, "_collection", None) and vectorstore._collection.count() > 0:
            return vectorstore
    except Exception:
        pass
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=200, length_function=len)
    txt_files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.endswith(".txt")]
    for path in txt_files:
        docs = TextLoader(path, encoding="utf-8").load()
        chunks = splitter.split_documents(docs)
        ids = [sid(c.page_content) for c in chunks]
        vectorstore.add_documents(chunks, ids=ids)
    pdf_files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.lower().endswith(".pdf")]
    for path in pdf_files:
        docs = PyMuPDFLoader(path).load()
        chunks = splitter.split_documents(docs)
        ids = [sid(c.page_content) for c in chunks]
        try:
            vectorstore.add_documents(chunks, ids=ids)
        except chromadb.errors.DuplicateIDError:
            continue
    url_files = [os.path.join(DATA_DIR, f) for f in os.listdir(DATA_DIR) if f.lower().endswith("urls.txt")]
    for path in url_files:
        for url in open(path, encoding="utf-8", errors="ignore").readlines():
            url = url.strip()
            if not url:
                continue
            try:
                docs = WebBaseLoader(url).load()
            except Exception:
                continue
            chunks = splitter.split_documents(docs)
            ids = [sid(c.page_content) for c in chunks]
            vectorstore.add_documents(chunks, ids=ids)
    return vectorstore

def retrieve_context(vectorstore, query, k=4):
    return vectorstore.similarity_search(query, k=k)

def run_once():
    collections_name = "documentation"
    vs = ensure_vectorstore(collections_name)
    generate_embeddings(vs)
    print("Completed")

#run_once()