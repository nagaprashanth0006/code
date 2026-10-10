import argparse
import hashlib
import importlib
import json
import math
import os
import sys
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Type

from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError
from typing_extensions import Annotated, TypedDict

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PERSIST_DIR = Path(os.getenv("VECTOR_STORE_DIR", BASE_DIR / "vector-store"))
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))
CHECKPOINT_DB = Path(
    os.getenv("CHECKPOINT_DB", BASE_DIR / "agent-checkpoints.sqlite3")
)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
CHAT_MODEL = os.getenv("CHAT_MODEL", "llama3.1:8b-instruct-q4_K_M")
EMBED_MODEL = os.getenv("EMBEDDINGS_MODEL", "nomic-embed-text")
DEFAULT_COLLECTION = os.getenv("VECTOR_COLLECTION", "default")

DETERMINISTIC_TOOL_CALLS = os.getenv("DETERMINISTIC_TOOL_CALLS", "false").lower() in (
    "1",
    "true",
    "yes",
)
DEBUG = os.getenv("DEBUG", "false").lower() in ("1", "true", "yes")

seed_env = os.getenv("MODEL_SEED")
MODEL_SEED = int(seed_env) if seed_env and seed_env.isdigit() else None

PERSIST_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DB.parent.mkdir(parents=True, exist_ok=True)

if os.getenv("LANGFUSE_BASE_URL") and not os.getenv("LANGFUSE_HOST"):
    os.environ["LANGFUSE_HOST"] = os.getenv("LANGFUSE_BASE_URL")

SYSTEM_PROMPT = (
    "You are a deterministic, tool-using assistant. "
    "Use tools when they are relevant, follow their schemas strictly, "
    "and explain reasoning briefly."
)


def log(message: str) -> None:
    if DEBUG:
        print(message, file=sys.stderr)


def safe_json_dumps(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=True)
    except TypeError:
        return json.dumps(str(value), ensure_ascii=True)


def pydantic_to_dict(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def deterministic_tool_call_id(name: str, args: Dict[str, Any]) -> str:
    raw = json.dumps({"name": name, "args": args}, sort_keys=True)
    return f"call_{hashlib.md5(raw.encode('utf-8')).hexdigest()[:10]}"


def build_langfuse_callbacks() -> List[Any]:
    callbacks: List[Any] = []
    try:
        module = importlib.import_module("langfuse.callback")
        handler = None
        for name in ("CallbackHandler", "LangfuseCallbackHandler"):
            handler = getattr(module, name, None)
            if handler:
                break
        if handler:
            callbacks.append(handler())
            log("Langfuse callbacks enabled.")
        else:
            log("Langfuse callback handler not found.")
    except Exception as exc:
        log(f"Langfuse callback not available: {exc}")
    return callbacks


@dataclass
class ToolSpec:
    name: str
    description: str
    schema: Type[BaseModel]
    func: Callable[..., Any]


class ToolRegistry:
    def __init__(self) -> None:
        self._specs: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._specs:
            raise ValueError(f"Tool already registered: {spec.name}")
        self._specs[spec.name] = spec

    def to_langchain_tools(self) -> List[StructuredTool]:
        tools: List[StructuredTool] = []
        for spec in self._specs.values():
            tools.append(
                StructuredTool.from_function(
                    func=spec.func,
                    name=spec.name,
                    description=spec.description,
                    args_schema=spec.schema,
                )
            )
        return tools

    def tool_names(self) -> List[str]:
        return list(self._specs.keys())

    def call_tool(self, name: str, args: Optional[Dict[str, Any]]) -> Any:
        if name not in self._specs:
            raise KeyError(f"Unknown tool: {name}")
        args = args or {}
        if not isinstance(args, dict):
            raise TypeError("Tool args must be a dict")
        spec = self._specs[name]
        parsed = spec.schema(**args)
        return spec.func(**pydantic_to_dict(parsed))


def load_external_tools(registry: ToolRegistry) -> None:
    modules = [m.strip() for m in os.getenv("EXTRA_TOOL_MODULES", "").split(",") if m]
    for module_name in modules:
        try:
            module = importlib.import_module(module_name)
            if hasattr(module, "register_tools"):
                module.register_tools(registry)
                log(f"Loaded external tools from {module_name}.")
            elif hasattr(module, "TOOLS"):
                for spec in getattr(module, "TOOLS"):
                    registry.register(spec)
                log(f"Loaded TOOLS from {module_name}.")
        except Exception as exc:
            log(f"Failed to load external tools from {module_name}: {exc}")


def cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class VectorStoreManager:
    def __init__(
        self,
        persist_dir: Path,
        embed_model: str,
        base_url: str,
    ) -> None:
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings = OllamaEmbeddings(
            model=embed_model, base_url=base_url, num_ctx=8192
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1200, chunk_overlap=150, length_function=len
        )
        self._stores: Dict[str, Chroma] = {}

    def ensure_collection(self, name: str) -> Chroma:
        if name not in self._stores:
            self._stores[name] = Chroma(
                collection_name=name,
                persist_directory=str(self.persist_dir),
                embedding_function=self.embeddings,
            )
        return self._stores[name]

    def list_collections(self) -> List[str]:
        try:
            chromadb = importlib.import_module("chromadb")
            client = chromadb.PersistentClient(path=str(self.persist_dir))
            return [c.name for c in client.list_collections()]
        except Exception as exc:
            log(f"Failed to list collections: {exc}")
            return []

    def collection_stats(self, name: str) -> Dict[str, Any]:
        vs = self.ensure_collection(name)
        return {"collection": name, "count": vs._collection.count()}

    def peek_documents(self, name: str, limit: int, content_chars: int) -> List[Dict[str, Any]]:
        vs = self.ensure_collection(name)
        payload = vs._collection.get(
            limit=limit,
            include=["documents", "metadatas"],
        )
        docs: List[Dict[str, Any]] = []
        for doc, meta, doc_id in zip(
            payload.get("documents", []),
            payload.get("metadatas", []),
            payload.get("ids", []),
        ):
            docs.append(
                {
                    "id": doc_id,
                    "content": (doc or "")[:content_chars],
                    "metadata": meta or {},
                }
            )
        return docs

    def generate_embeddings(self, texts: List[str], preview_dims: int) -> Dict[str, Any]:
        vectors = self.embeddings.embed_documents(texts)
        if not vectors:
            return {"dimensions": 0, "vectors": []}
        preview = [v[:preview_dims] for v in vectors]
        return {"dimensions": len(vectors[0]), "vectors": preview}

    def upsert_texts(
        self,
        texts: List[str],
        collection_name: str,
        metadatas: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        vs = self.ensure_collection(collection_name)
        docs: List[Document] = []
        metadatas = metadatas or []
        for i, text in enumerate(texts):
            meta = metadatas[i] if i < len(metadatas) else {}
            docs.append(Document(page_content=text, metadata=meta))
        chunks = self.splitter.split_documents(docs)
        ids = [self._sid(c.page_content) for c in chunks]
        vs.add_documents(chunks, ids=ids)
        return {"collection": collection_name, "added_chunks": len(chunks)}

    def retrieve(
        self,
        query: str,
        collection_name: str,
        k: int,
        fetch_k: int,
        rerank: bool,
        rerank_k: int,
    ) -> Dict[str, Any]:
        vs = self.ensure_collection(collection_name)
        docs = vs.similarity_search(query, k=fetch_k)
        if rerank:
            docs = self._rerank(query, docs, rerank_k)
        else:
            docs = docs[:k]
        return {
            "query": query,
            "collection": collection_name,
            "results": self._serialize_docs(docs),
        }

    def documents_from_uploads(self, uploaded_files: Iterable[Any]) -> List[Document]:
        docs: List[Document] = []
        for uf in uploaded_files:
            name = getattr(uf, "name", "upload")
            suffix = Path(name).suffix.lower()
            try:
                uf.seek(0)
            except Exception:
                pass
            data = uf.read()
            if suffix == ".txt":
                docs.extend(self._load_text_bytes(name, data))
            elif suffix == ".pdf":
                docs.extend(self._load_pdf_bytes(name, data))
        return docs

    def _load_text_bytes(self, name: str, data: bytes) -> List[Document]:
        text = data.decode("utf-8", errors="ignore")
        if not text.strip():
            return []
        return [Document(page_content=text, metadata={"source": name})]

    def _load_pdf_bytes(self, name: str, data: bytes) -> List[Document]:
        try:
            import fitz
        except Exception as exc:
            raise RuntimeError("PyMuPDF is required for PDF ingestion.") from exc
        pdf = fitz.open(stream=data, filetype="pdf")
        docs: List[Document] = []
        for i, page in enumerate(pdf):
            text = page.get_text() or ""
            if text.strip():
                docs.append(
                    Document(
                        page_content=text,
                        metadata={"source": name, "page": i + 1, "pages": pdf.page_count},
                    )
                )
        pdf.close()
        return docs

    def _rerank(self, query: str, docs: List[Document], k: int) -> List[Document]:
        if not docs:
            return []
        query_vec = self.embeddings.embed_query(query)
        doc_texts = [d.page_content for d in docs]
        doc_vecs = self.embeddings.embed_documents(doc_texts)
        scored = []
        for doc, vec in zip(docs, doc_vecs):
            scored.append((cosine_similarity(query_vec, vec), doc))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [doc for _, doc in scored[:k]]

    def _sid(self, text: str) -> str:
        return hashlib.md5(text.encode("utf-8")).hexdigest()

    def _serialize_docs(self, docs: List[Document], limit: int = 800) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for doc in docs:
            out.append(
                {
                    "content": doc.page_content[:limit],
                    "metadata": doc.metadata,
                }
            )
        return out


class EmbedTextsInput(BaseModel):
    texts: List[str] = Field(..., min_items=1, description="Texts to embed")
    preview_dims: int = Field(6, ge=1, le=32, description="Preview vector dims")


class UpsertTextsInput(BaseModel):
    collection_name: str = Field(DEFAULT_COLLECTION, description="Collection name")
    texts: List[str] = Field(..., min_items=1, description="Texts to store")
    metadatas: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="Optional metadata per text"
    )


class RetrieveInput(BaseModel):
    query: str = Field(..., description="Search query")
    collection_name: str = Field(DEFAULT_COLLECTION, description="Collection name")
    k: int = Field(4, ge=1, le=20, description="Top results")
    fetch_k: int = Field(8, ge=1, le=50, description="Initial fetch size")
    rerank: bool = Field(True, description="Enable rerank")
    rerank_k: int = Field(4, ge=1, le=20, description="Rerank top k")


class PeekCollectionInput(BaseModel):
    collection_name: str = Field(DEFAULT_COLLECTION, description="Collection name")
    limit: int = Field(5, ge=1, le=50, description="How many docs to show")
    content_chars: int = Field(200, ge=50, le=1000, description="Doc preview chars")


class CollectionStatsInput(BaseModel):
    collection_name: str = Field(DEFAULT_COLLECTION, description="Collection name")


class NoArgs(BaseModel):
    pass


class AgentState(TypedDict):
    messages: Annotated[List[Any], add_messages]


def build_llm(tools: List[StructuredTool]) -> Any:
    llm_kwargs: Dict[str, Any] = {
        "model": CHAT_MODEL,
        "base_url": OLLAMA_BASE_URL,
        "temperature": 0,
        "timeout": 120,
        "num_ctx": 4096,
    }
    if MODEL_SEED is not None:
        llm_kwargs["seed"] = MODEL_SEED
    llm = ChatOllama(**llm_kwargs)
    return llm.bind_tools(tools)


def parse_explicit_tool_call(
    text: str, tool_names: List[str]
) -> Optional[Tuple[str, Dict[str, Any]]]:
    text = text.strip()
    if text.startswith("/tool "):
        _, rest = text.split(" ", 1)
        name, _, args_text = rest.partition(" ")
    elif text.startswith("/"):
        name, _, args_text = text[1:].partition(" ")
    else:
        return None
    if name not in tool_names:
        return None
    args_text = args_text.strip()
    args = {}
    if args_text:
        args = json.loads(args_text)
    return name, args


def build_graph(
    llm: Any, registry: ToolRegistry, checkpointer: SqliteSaver
) -> Any:
    def agent_node(
        state: AgentState, config: Optional[Dict[str, Any]] = None
    ) -> Dict[str, List[Any]]:
        messages = state["messages"]
        config = config or {}
        last = messages[-1] if messages else None
        if DETERMINISTIC_TOOL_CALLS and isinstance(last, HumanMessage):
            try:
                parsed = parse_explicit_tool_call(last.content, registry.tool_names())
            except json.JSONDecodeError:
                parsed = None
            if parsed:
                name, args = parsed
                tool_call_id = deterministic_tool_call_id(name, args)
                return {
                    "messages": [
                        AIMessage(
                            content="",
                            tool_calls=[
                                {"name": name, "args": args, "id": tool_call_id}
                            ],
                        )
                    ]
                }
            if last.content.strip().startswith("/"):
                return {
                    "messages": [
                        AIMessage(
                            content=(
                                "Deterministic mode is on. Use /tool <name> {json} "
                                "or /<name> {json}."
                            )
                        )
                    ]
                }

        if isinstance(last, HumanMessage):
            auto = maybe_auto_retrieve(last.content, messages, config, registry, llm)
            if auto:
                return {"messages": auto}
        response = llm.invoke(
            [SystemMessage(content=SYSTEM_PROMPT)] + messages, config=config
        )
        return {"messages": [response]}

    def tool_node(state: AgentState) -> Dict[str, List[Any]]:
        last = state["messages"][-1]
        if not isinstance(last, AIMessage) or not last.tool_calls:
            return {"messages": []}
        outputs: List[ToolMessage] = []
        for call in last.tool_calls:
            name = call.get("name")
            args = call.get("args") or {}
            call_id = call.get("id", deterministic_tool_call_id(name, args))
            try:
                result = registry.call_tool(name, args)
                content = safe_json_dumps(result)
            except ValidationError as exc:
                content = safe_json_dumps({"error": "validation", "detail": str(exc)})
            except Exception as exc:
                content = safe_json_dumps({"error": "execution", "detail": str(exc)})
            outputs.append(ToolMessage(content=content, tool_call_id=call_id))
        return {"messages": outputs}

    def route_from_agent(state: AgentState) -> str:
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return END

    builder = StateGraph(AgentState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", tool_node)
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", route_from_agent, {"tools": "tools", END: END})
    builder.add_edge("tools", "agent")
    return builder.compile(checkpointer=checkpointer)


def should_auto_retrieve(text: str) -> bool:
    query = text.lower()
    if not query or query.startswith("/"):
        return False
    if "?" in query:
        return True
    keywords = (
        "email",
        "phone",
        "mobile",
        "contact",
        "address",
        "details",
        "document",
        "doc",
        "pdf",
        "file",
        "embedded",
        "collection",
        "record",
        "lookup",
        "find",
    )
    return any(word in query for word in keywords)


def maybe_auto_retrieve(
    user_text: str,
    messages: List[Any],
    config: Dict[str, Any],
    registry: ToolRegistry,
    llm: Any,
) -> Optional[List[Any]]:
    if DETERMINISTIC_TOOL_CALLS:
        return None
    if "retrieve" not in registry.tool_names():
        return None
    if not should_auto_retrieve(user_text):
        return None
    try:
        if "collection_stats" in registry.tool_names():
            stats = registry.call_tool(
                "collection_stats", {"collection_name": DEFAULT_COLLECTION}
            )
            if isinstance(stats, dict) and stats.get("count") == 0:
                return None
    except Exception:
        pass

    args = {
        "query": user_text,
        "collection_name": DEFAULT_COLLECTION,
        "k": 4,
        "fetch_k": 8,
        "rerank": True,
        "rerank_k": 4,
    }
    call_id = deterministic_tool_call_id("retrieve", args)
    tool_call = AIMessage(
        content="",
        tool_calls=[{"name": "retrieve", "args": args, "id": call_id}],
    )
    try:
        result = registry.call_tool("retrieve", args)
        content = safe_json_dumps(result)
    except ValidationError as exc:
        content = safe_json_dumps({"error": "validation", "detail": str(exc)})
    except Exception as exc:
        content = safe_json_dumps({"error": "execution", "detail": str(exc)})
    tool_msg = ToolMessage(content=content, tool_call_id=call_id)
    followup = llm.invoke(
        [SystemMessage(content=SYSTEM_PROMPT)] + messages + [tool_call, tool_msg],
        config=config,
    )
    return [tool_call, tool_msg, followup]


def extract_tool_trace(messages: List[Any]) -> List[Dict[str, Any]]:
    trace: List[Dict[str, Any]] = []
    for msg in messages:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            trace.append({"tool_calls": msg.tool_calls})
        if isinstance(msg, ToolMessage):
            trace.append(
                {"tool_call_id": msg.tool_call_id, "tool_result": msg.content}
            )
    return trace


def pick_last_assistant_text(messages: List[Any]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content:
            return msg.content
    for msg in reversed(messages):
        if isinstance(msg, ToolMessage):
            return msg.content
    return ""


class AgentRuntime:
    def __init__(self) -> None:
        self.callbacks = build_langfuse_callbacks()
        self.vector_manager = VectorStoreManager(
            persist_dir=PERSIST_DIR,
            embed_model=EMBED_MODEL,
            base_url=OLLAMA_BASE_URL,
        )
        self.registry = ToolRegistry()
        self._register_core_tools()
        load_external_tools(self.registry)
        self.llm = build_llm(self.registry.to_langchain_tools())
        self._checkpoint_conn = sqlite3.connect(
            str(CHECKPOINT_DB), check_same_thread=False
        )
        checkpointer = SqliteSaver(self._checkpoint_conn)
        self.graph = build_graph(self.llm, self.registry, checkpointer)

    def _register_core_tools(self) -> None:
        vm = self.vector_manager

        def embed_texts(texts: List[str], preview_dims: int) -> Dict[str, Any]:
            return vm.generate_embeddings(texts, preview_dims)

        def upsert_texts(
            collection_name: str, texts: List[str], metadatas: Optional[List[Dict[str, Any]]]
        ) -> Dict[str, Any]:
            return vm.upsert_texts(texts, collection_name, metadatas)

        def retrieve(
            query: str,
            collection_name: str,
            k: int,
            fetch_k: int,
            rerank: bool,
            rerank_k: int,
        ) -> Dict[str, Any]:
            return vm.retrieve(query, collection_name, k, fetch_k, rerank, rerank_k)

        def list_collections() -> Dict[str, Any]:
            return {"collections": vm.list_collections()}

        def collection_stats(collection_name: str) -> Dict[str, Any]:
            return vm.collection_stats(collection_name)

        def peek_collection(
            collection_name: str, limit: int, content_chars: int
        ) -> Dict[str, Any]:
            return {
                "collection": collection_name,
                "documents": vm.peek_documents(collection_name, limit, content_chars),
            }

        self.registry.register(
            ToolSpec(
                name="embed_texts",
                description="Generate embeddings for texts.",
                schema=EmbedTextsInput,
                func=embed_texts,
            )
        )
        self.registry.register(
            ToolSpec(
                name="upsert_texts",
                description="Store texts in the vector collection.",
                schema=UpsertTextsInput,
                func=upsert_texts,
            )
        )
        self.registry.register(
            ToolSpec(
                name="retrieve",
                description="Retrieve similar documents with optional rerank.",
                schema=RetrieveInput,
                func=retrieve,
            )
        )
        self.registry.register(
            ToolSpec(
                name="list_collections",
                description="List vector store collections.",
                schema=NoArgs,
                func=list_collections,
            )
        )
        self.registry.register(
            ToolSpec(
                name="collection_stats",
                description="Get collection document count.",
                schema=CollectionStatsInput,
                func=collection_stats,
            )
        )
        self.registry.register(
            ToolSpec(
                name="peek_collection",
                description="Show a small sample of documents in a collection.",
                schema=PeekCollectionInput,
                func=peek_collection,
            )
        )

    def invoke(self, user_input: str, thread_id: str) -> Tuple[str, List[Dict[str, Any]], Any]:
        state = {"messages": [HumanMessage(content=user_input)]}
        config = {"configurable": {"thread_id": thread_id}, "callbacks": self.callbacks}
        result = self.graph.invoke(state, config=config)
        messages = result["messages"]
        reply = pick_last_assistant_text(messages)
        trace = extract_tool_trace(messages)
        return reply, trace, result


def run_cli() -> None:
    runtime = AgentRuntime()
    thread_id = f"cli-{int(time.time())}"
    print("Type 'quit' to exit.")
    while True:
        user_input = input("User: ").strip()
        if user_input.lower() in {"quit", "exit", "q"}:
            break
        reply, trace, _ = runtime.invoke(user_input, thread_id)
        print(f"Assistant: {reply}")
        if trace:
            print(f"Tool trace: {safe_json_dumps(trace)}")


def run_streamlit() -> None:
    try:
        import streamlit as st
    except Exception as exc:
        raise RuntimeError("Streamlit is not installed. Use --cli or install it.") from exc

    st.set_page_config(page_title="Pluggable Tools Agent", layout="wide")
    st.title("Pluggable Tools Agent")

    @st.cache_resource
    def _get_runtime() -> AgentRuntime:
        return AgentRuntime()

    runtime = _get_runtime()

    if "thread_id" not in st.session_state:
        st.session_state.thread_id = f"ui-{int(time.time())}"
    if "chat_messages" not in st.session_state:
        st.session_state.chat_messages = []
    if "last_trace" not in st.session_state:
        st.session_state.last_trace = []

    with st.sidebar:
        st.header("Vector Store")
        collection = st.text_input("Collection", value=DEFAULT_COLLECTION)
        st.caption("Vector store location: " + str(PERSIST_DIR))

        st.subheader("Collections")
        if st.button("List collections"):
            st.session_state.collections = runtime.vector_manager.list_collections()
        if "collections" in st.session_state:
            st.json(st.session_state.collections)

        st.subheader("Collection stats")
        if st.button("Get stats"):
            stats = runtime.vector_manager.collection_stats(collection)
            st.json(stats)

        st.subheader("Peek documents")
        peek_limit = st.number_input("Peek limit", min_value=1, max_value=50, value=5)
        peek_chars = st.number_input(
            "Preview chars", min_value=50, max_value=1000, value=200
        )
        if st.button("Peek"):
            docs = runtime.vector_manager.peek_documents(
                collection, int(peek_limit), int(peek_chars)
            )
            st.json(docs)

        st.subheader("Embed uploads")
        uploads = st.file_uploader(
            "Upload .txt or .pdf",
            type=["txt", "pdf"],
            accept_multiple_files=True,
        )
        if st.button("Embed files"):
            if not uploads:
                st.warning("Upload at least one file.")
            else:
                try:
                    docs = runtime.vector_manager.documents_from_uploads(uploads)
                    if not docs:
                        st.warning("No text extracted from uploads.")
                    else:
                        result = runtime.vector_manager.upsert_texts(
                            [d.page_content for d in docs],
                            collection,
                            [d.metadata for d in docs],
                        )
                        st.success(f"Embedded {result['added_chunks']} chunks.")
                except Exception as exc:
                    st.error(str(exc))

        st.subheader("Deterministic mode")
        st.write("DETERMINISTIC_TOOL_CALLS=" + str(DETERMINISTIC_TOOL_CALLS))
        st.caption("Use /tool <name> {json} to call tools explicitly.")

    for msg in st.session_state.chat_messages:
        st.chat_message(msg["role"]).write(msg["content"])

    user_input = st.chat_input("Ask something")
    if user_input:
        st.session_state.chat_messages.append({"role": "user", "content": user_input})
        reply, trace, _ = runtime.invoke(user_input, st.session_state.thread_id)
        st.session_state.chat_messages.append(
            {"role": "assistant", "content": reply}
        )
        st.session_state.last_trace = trace
        st.chat_message("assistant").write(reply)

    if st.session_state.last_trace:
        with st.expander("Tool trace", expanded=False):
            st.json(st.session_state.last_trace)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pluggable tools agent")
    parser.add_argument("--cli", action="store_true", help="Run a CLI session")
    args, _ = parser.parse_known_args()
    if args.cli:
        run_cli()
        return
    run_streamlit()


if __name__ == "__main__":
    main()
