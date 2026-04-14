from http import client

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
import chromadb
from dotenv import load_dotenv

load_dotenv()

def ingest_pdf(
    pdf_path: str,
    persist_directory: str = "./chroma_db",
    collection_name: str = "python_docs",
    chunk_size: int = 350,
    chunk_overlap: int = 50,
) -> dict:
    loader = PyPDFLoader(pdf_path)
    docs = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    chunks = splitter.split_documents(docs)

    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    # Clear existing collection before ingesting
    client = chromadb.PersistentClient(path=persist_directory)
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass  # collection didn't exist yet, that's fine
    Chroma.from_documents(
        chunks,
        embeddings,
        persist_directory=persist_directory,
        collection_name=collection_name,
        collection_metadata={"hnsw:space": "cosine"}
    )

    return {
        "status": "ok",
        "documents_loaded": len(docs),
        "chunks_ingested": len(chunks),
    }