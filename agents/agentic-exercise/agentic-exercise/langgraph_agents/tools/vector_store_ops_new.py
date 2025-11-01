import os
os.environ["PYTHONWARNINGS"] = "ignore::urllib3.exceptions.NotOpenSSLWarning"
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ["CHROMA_TELEMETRY"] = "False"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

from pprint import pprint
import re
import hashlib
import warnings
from typing import Optional, Iterable, List, Tuple

warnings.filterwarnings("ignore", category=Warning, module="urllib3")

from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader, PyMuPDFLoader, WebBaseLoader
from langchain_ollama import OllamaEmbeddings
from langchain_chroma import Chroma
import chromadb

# --- Paths & defaults ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(BASE_DIR, "..", "data")))
CHROMA_PERSIST_DIR = os.path.abspath(os.path.join(DATA_DIR, "chroma_db"))

DEFAULT_COLLECTION = "text-rag"
EMBEDDING_MODEL = "nomic-embed-text"
LANGUAGE_MODEL = "mistral"

# Accept only alnum, dash, underscore, dot (common for namespacing)
_VALID_COLLECTION_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


# ---------- Utilities ----------
def sid(text: str) -> str:
    """Stable ID from content (exact duplicates collapse)."""
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def _validate_collection_name(name: str) -> str:
    name = (name or DEFAULT_COLLECTION).strip()
    if not _VALID_COLLECTION_RE.match(name):
        raise ValueError(
            f"Invalid collection name '{name}'. Use only letters, numbers, '.', '-' or '_', up to 128 chars."
        )
    return name


def _ensure_dirs():
    os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
    try:
        os.chmod(CHROMA_PERSIST_DIR, 0o755)
    except Exception:
        pass


def _get_client() -> chromadb.PersistentClient:
    _ensure_dirs()
    return chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)


def _get_embeddings() -> OllamaEmbeddings:
    return OllamaEmbeddings(model=EMBEDDING_MODEL)


def _existing_ids_in_batches(collection, ids: List[str], batch_size: int = 1000) -> set:
    """Return the subset of ids that already exist in the Chroma collection."""
    existing = set()
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        # chromadb Collection.get() returns only present ids; missing are dropped
        got = collection.get(ids=batch)
        if got and "ids" in got and got["ids"]:
            existing.update(got["ids"])
    return existing


# ---------- Vector store lifecycle ----------
def ensure_vectorstore(collection: Optional[str] = None, *, reset: bool = False) -> Tuple[Chroma, bool]:
    """
    Ensure a Chroma vector store for the given collection.
    - If present, loads it.
    - If missing, creates it.
    - If reset=True, deletes only that collection and re-creates it.
    Returns: (vectorstore, created_bool)
    """
    name = _validate_collection_name(collection or DEFAULT_COLLECTION)
    client = _get_client()

    if reset:
        # Delete only this collection; don't wipe the entire directory
        try:
            client.delete_collection(name)
        except Exception:
            pass  # ok if it didn't exist

    # Detect existence
    existing_names = {c.name for c in client.list_collections()}
    created = name not in existing_names

    # Use LangChain wrapper with explicit client (avoids accidental new DB)
    vs = Chroma(
        client=client,
        collection_name=name,
        embedding_function=_get_embeddings(),
    )
    return vs, created


# ---------- Ingestion / Indexing ----------
def _iter_source_docs(data_dir: str) -> Iterable[Tuple[List, List[str]]]:
    """
    Yield (docs, source_ids) tuples per source file/url bucket.
    Each chunk is given a stable content-based id (sid(content)).
    """
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=200, length_function=len)

    # .txt files
    txt_files = [os.path.join(data_dir, f) for f in os.listdir(data_dir) if f.endswith(".txt")]
    for path in txt_files:
        docs = TextLoader(path, encoding="utf-8").load()
        chunks = splitter.split_documents(docs)
        yield chunks, [sid(c.page_content) for c in chunks]

    # .pdf files
    pdf_files = [os.path.join(data_dir, f) for f in os.listdir(data_dir) if f.lower().endswith(".pdf")]
    for path in pdf_files:
        docs = PyMuPDFLoader(path).load()
        chunks = splitter.split_documents(docs)
        yield chunks, [sid(c.page_content) for c in chunks]

    # URL lists (*.urls.txt)
    url_files = [os.path.join(data_dir, f) for f in os.listdir(data_dir) if f.lower().endswith("urls.txt")]
    for path in url_files:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            urls = [u.strip() for u in fh if u.strip()]
        for url in urls:
            try:
                docs = WebBaseLoader(url).load()
            except Exception:
                continue
            chunks = splitter.split_documents(docs)
            yield chunks, [sid(c.page_content) for c in chunks]


def index_documents_if_needed(vectorstore: Chroma, data_dir: Optional[str] = None) -> int:
    """
    Idempotent ingestion:
    - Computes stable IDs per chunk.
    - Checks which IDs already exist in the collection.
    - Adds only the missing chunks.
    Returns: number of chunks newly added.
    """
    data_dir = data_dir or DATA_DIR

    # Access the underlying Chroma collection (safe for this purpose)
    collection = getattr(vectorstore, "_collection", None)
    if collection is None:
        raise RuntimeError("Vectorstore has no underlying Chroma collection.")

    newly_added = 0
    for chunks, ids in _iter_source_docs(data_dir):
        if not chunks:
            continue

        existing = _existing_ids_in_batches(collection, ids)
        # Filter to only new docs
        to_add_docs = []
        to_add_ids = []
        for doc, _id in zip(chunks, ids):
            if _id not in existing:
                to_add_docs.append(doc)
                to_add_ids.append(_id)

        if to_add_docs:
            vectorstore.add_documents(to_add_docs, ids=to_add_ids)
            newly_added += len(to_add_docs)

    # Persist is implicit with PersistentClient; LangChain wrapper flushes as needed.
    return newly_added


# ---------- Retrieval ----------
def retrieve_context(vectorstore: Chroma, query: str, k: int = 4):
    """
    Pure retrieval (no ingestion side-effects).
    Agents/tools can call this safely without regenerating embeddings.
    """
    return vectorstore.similarity_search(query, k=k)


# ---------- Example one-time run ----------
def run_once():
    collection_name = "documentation"
    vs, created = ensure_vectorstore(collection_name)
    added = index_documents_if_needed(vs)
    print(f"Collection: {collection_name} | created={created} | newly_indexed_chunks={added}")


if __name__ == "__main__":
    #run_once()
    collection_name = "documentation"
    vs, created = ensure_vectorstore(collection_name)
    added = index_documents_if_needed(vs)
    print(f"Collection: {collection_name} | created={created} | newly_indexed_chunks={added}")
    pprint(retrieve_context(vectorstore=vs, query="Check attached PCI devices in linux machine?"))
