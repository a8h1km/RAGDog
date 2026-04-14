from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_chroma import Chroma
from dotenv import load_dotenv
import time
_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
load_dotenv()

PERSIST_DIRECTORY = "./chroma_db"
COLLECTION_NAME = "python_docs"

def _clean_metadata(metadata: dict) -> dict:
    return {k: v for k, v in metadata.items() if k != "source"}

def format_docs(docs):
    return "\n\n".join(f"Source: {doc.metadata}\nContent: {doc.page_content}" for doc in docs)

def _short_content(text: str, max_len: int = 200) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."

def _retrieve_chunks(vectorstore, question: str, k: int = 6, max_chunks: int = 4):
    """Shared retrieval + deduplication logic with fetched and used counts."""
    scored_results = vectorstore.similarity_search_with_score(question, k=k)
    chunks_retrieved = len(scored_results)

    seen = set()
    unique_results = []
    for doc, score in scored_results:
        fingerprint = doc.page_content[:100]
        if fingerprint not in seen:
            seen.add(fingerprint)
            unique_results.append((doc, score))

    return unique_results[:max_chunks], chunks_retrieved

def _build_vectorstore():
    return Chroma(
        persist_directory=PERSIST_DIRECTORY,
        embedding_function=_embeddings,
        collection_name=COLLECTION_NAME,
    )

def _build_chunk_scores(unique_results):
    return [
        {
            "content": _short_content(doc.page_content),
            "score": round(float(score), 4),
            "metadata": _clean_metadata(doc.metadata or {}),
        }
        for doc, score in unique_results
    ]

def _build_score_stats(chunk_scores: list[dict]) -> dict:
    if not chunk_scores:
        return {
            "avg_chunk_score": 0.0,
            "score_spread": 0.0,
            "min_chunk_score": 0.0,
            "max_chunk_score": 0.0,
        }

    values = [float(chunk["score"]) for chunk in chunk_scores]
    min_score = min(values)
    max_score = max(values)
    avg_score = sum(values) / len(values)

    return {
        "avg_chunk_score": round(avg_score, 4),
        "score_spread": round(max_score - min_score, 4),
        "min_chunk_score": round(min_score, 4),
        "max_chunk_score": round(max_score, 4),
    }

def _extract_token_usage(response) -> tuple[int, int]:
    metadata = getattr(response, "response_metadata", {}) or {}
    token_usage = metadata.get("token_usage", {}) or metadata.get("usage", {})
    input_tokens = int(token_usage.get("prompt_tokens", token_usage.get("input_tokens", 0)) or 0)
    output_tokens = int(token_usage.get("completion_tokens", token_usage.get("output_tokens", 0)) or 0)
    return input_tokens, output_tokens

def _extract_response_text(response) -> str:
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if text:
                    parts.append(str(text))
            elif item:
                parts.append(str(item))
        return "".join(parts)
    return str(content)

def query_rag(question: str, k: int = 6) -> dict:
    overall_start = time.perf_counter()

    vectorstore = _build_vectorstore()

    retrieval_start = time.perf_counter()
    unique_results, chunks_retrieved = _retrieve_chunks(vectorstore, question, k)
    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

    context_docs = [doc for doc, _ in unique_results]
    chunk_scores = _build_chunk_scores(unique_results)
    score_stats = _build_score_stats(chunk_scores)

    prompt = ChatPromptTemplate.from_template("""Answer the question based ONLY on the following context:
{context}

Question: {question}
""")
    model = ChatGroq(model="llama-3.1-8b-instant", temperature=0)

    generation_start = time.perf_counter()
    prompt_value = prompt.invoke({
        "context": format_docs(context_docs),
        "question": question,
    })
    model_response = model.invoke(prompt_value)
    generation_ms = (time.perf_counter() - generation_start) * 1000

    input_tokens, output_tokens = _extract_token_usage(model_response)
    answer = _extract_response_text(model_response)

    return {
        "answer": answer,
        "latency_ms": round((time.perf_counter() - overall_start) * 1000, 2),
        "retrieval_ms": round(retrieval_ms, 2),
        "generation_ms": round(generation_ms, 2),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "chunks_retrieved": chunks_retrieved,
        "chunks_used": len(unique_results),
        "chunk_scores": chunk_scores,
        **score_stats,
    }

def chat_rag(question: str, history: list[dict] | None = None, k: int = 6) -> dict:
    overall_start = time.perf_counter()
    history = history or []

    vectorstore = _build_vectorstore()

    retrieval_start = time.perf_counter()
    unique_results, chunks_retrieved = _retrieve_chunks(vectorstore, question, k)
    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

    context_docs = [doc for doc, _ in unique_results]
    chunk_scores = _build_chunk_scores(unique_results)
    score_stats = _build_score_stats(chunk_scores)

    # Build conversation history string (last 6 messages max)
    history_text = ""
    for msg in history[-6:]:
        role = "User" if msg["role"] == "user" else "Assistant"
        history_text += f"{role}: {msg['content']}\n"

    prompt = ChatPromptTemplate.from_template("""You are a helpful assistant. Use the context below to answer.
If the answer isn't in the context, say you don't know.

Context:
{context}

Conversation so far:
{history}
User: {question}
Assistant:""")

    model = ChatGroq(model="llama-3.1-8b-instant", temperature=0)

    generation_start = time.perf_counter()
    prompt_value = prompt.invoke({
        "context": format_docs(context_docs),
        "history": history_text,
        "question": question,
    })
    model_response = model.invoke(prompt_value)
    generation_ms = (time.perf_counter() - generation_start) * 1000

    input_tokens, output_tokens = _extract_token_usage(model_response)
    answer = _extract_response_text(model_response)

    return {
        "answer": answer,
        "latency_ms": round((time.perf_counter() - overall_start) * 1000, 2),
        "retrieval_ms": round(retrieval_ms, 2),
        "generation_ms": round(generation_ms, 2),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "chunks_retrieved": chunks_retrieved,
        "chunks_used": len(unique_results),
        "chunk_scores": chunk_scores,
        **score_stats,
    }