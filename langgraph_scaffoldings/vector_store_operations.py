"""
Operations on VectorStore:

1. Embeddings generation(vectorization)
2. Document persistence(storing into the vector DB)
3. Retrieval(to read the vectors or embeddings from DB)

1. Embeddings generation:
- Loader reads the data from file/stream/source. Dedicated loaders for different types of files. CSVLoader for CSV files, PyMuPDFLoader for pdf
- Needs chunks of data. Data can be chunked/split using normal text splitters or context aware splitters like SemanticChunker or RecursiveCharacterTextSplitters
- Converts text or binary data into numerical vectors(floating point numbers usually) using an embedding model like - nomic-embed-text

2. Document persistence(Vector Store)
- Vectors are grouped together into documents and stored in vector store as collections. A collection can have multiple documents/records.
- Each document/record is in the form of {uuid + embedding + optional document text + metadata}
- Single vector store can store multiple collections. Collections are analogous to tables in RDBM systems.

3. Retrieval and searching
- Retriever can retrieve data from local or external vector stores. Can take args like search type(default MMR), top_k, fetch_k etc.
- Similarity Searches - Performs one of the Cosine similarity(default), Euclidean distance or Dot Product type searches and retrieves the documents that are similar to given query.

Note: Efficient search employs indexing methods like HNSW(Hierarchial Navigavle Small Worlds) and is dependent on vector store type.

"""

from langchain_community.document_loaders import TextLoader, PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
from os import path, mkdir, makedirs, listdir
from langchain_core.documents import Document

import hashlib
from PyPDF2 import PdfReader
import fitz
from pathlib import Path
from io import BytesIO

# Global constants

#PERSISTENCE_DIR = "./vector-store"
PERSISTENCE_DIR = "C:\\vector-store"
DATA_DIR = "./data"
EMBEDDINGS_MODEL = "nomic-embed-text"

if not path.exists(PERSISTENCE_DIR):
    mkdir(PERSISTENCE_DIR)
if not path.exists(DATA_DIR):
    mkdir(DATA_DIR)


## Helpers
def sid(page_content):
    return hashlib.md5(page_content.encode("utf-8")).hexdigest()

def uploaded_file_to_text(uploaded_file):
    uploaded_file.seek(0)
    text = uploaded_file.read().decode("utf-8", errors="ignore")
    if not text.strip():
        return []
    return [Document(page_content=text, metadata={"source": uploaded_file.name})]

def uploaded_file_to_pdf(uploaded_file):
    # uploaded_file.seek(0)
    # data = BytesIO(uploaded_file.read())
    # pdf = PdfReader(data)
    # docs = []
    # for i, page in enumerate(pdf.pages):
    #     try:
    #         text = page.extract_text() or ""
    #     except Exception:
    #         text = ""
    #     if text.strip():
    #         docs.append(
    #             Document(
    #                 page_content=text,
    #                 metadata={
    #                     "source": uploaded_file.name,
    #                     "page": i + 1,
    #                     "pages": len(pdf.pages),
    #                 },
    #             )
    #         )
    # return docs
    uploaded_file.seek(0)
    blob = uploaded_file.read()
    pdf = fitz.open(stream=blob, filetype="pdf")
    out: list[Document] = []
    for i, page in enumerate(pdf):
        text = page.get_text() or ""
        if text.strip():
            out.append(
                Document(
                    page_content=text,
                    metadata={"source": uploaded_file.name, "page": i + 1, "pages": pdf.page_count},
                )
            )
    pdf.close()
    return out

def _uploads_to_documents(uploaded_files) -> list[Document]:
    docs: list[Document] = []
    for uf in uploaded_files:
        suffix = Path(uf.name).suffix.lower()
        if suffix == ".txt":
            docs.extend(uploaded_file_to_text(uf))
        elif suffix == ".pdf":
            docs.extend(uploaded_file_to_pdf(uf))
    print(f"Given {len(uploaded_files)} uploaded files to documents, returning {len(docs)} documents.")
    return docs

## Main methods

def ensure_vectorstore(collection_name):
    makedirs(PERSISTENCE_DIR, exist_ok=True)
    embeddings = OllamaEmbeddings(model=EMBEDDINGS_MODEL, num_ctx=8192)
    return Chroma(
        collection_name = collection_name,
        persist_directory=PERSISTENCE_DIR,
        embedding_function=embeddings
    )

def vectorize_docs(uploaded_files, collection_name="default"):
    vs = ensure_vectorstore(collection_name=collection_name)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1500, chunk_overlap=100, length_function=len
    )

    try:
        counter = 0
        docs = _uploads_to_documents(uploaded_files)
        if not docs:
            return False, "No text extracted."

        for file in docs:
            counter += 1
            chunks = splitter.split_documents(docs)
            ids = [sid(c.page_content) for c in chunks]
            vs.add_documents(chunks, ids=ids)
            print(f"Document: {counter}/{len(docs)} - Indexed {len(chunks)} chunks into '{collection_name}'.")

        print("Completed.")
        return True, ""
    except Exception as e:
        print("Exception while vectorizing:", e)
        return False, e
    ## Already persisted. No need for explicit vectorstore.persist() call

def refresh_embeddings(collection_name="default"):
    vs = ensure_vectorstore(collection_name=collection_name)
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800, chunk_overlap=200, length_function=len
    )
    text_files = [path.join(DATA_DIR, f) for f in listdir(DATA_DIR) if f.lower().endswith(".txt")]
    for file in text_files:
        docs = TextLoader(file, encoding="utf-8").load()
        chunks = splitter.split_documents(docs)
        ids = [sid(c.page_content) for c in chunks]
        vs.add_documents(chunks, ids=ids)

    pdf_files = [path.join(DATA_DIR, f) for f in listdir(DATA_DIR) if f.lower().endswith("pdf")]
    for file in pdf_files:
        docs = PyMuPDFLoader(file).load()
        chunks = splitter.split_documents(docs)
        ids = [sid(c.page_content) for c in chunks]
        vs.add_documents(chunks, ids=ids)
    ## Already persisted. No need for explicit vectorstore.persist() call

def retrieve_context(vectorstore, query, k=4):
    return vectorstore.similarity_search(query, k=k)

if __name__ == "__main__":
    collections_name = "documentation"
    vs = ensure_vectorstore(collections_name)
    print("Collection name", getattr(vs, "_collection"), "Count of documents:", vs._collection.count())
    refresh_embeddings(collection_name=collections_name)
    print("After refresh")
    print("Collection name", getattr(vs, "_collection"), "Count of documents:", vs._collection.count())

    query = "What is name of frontend project"
    context = retrieve_context(vs, query)
    print(context)