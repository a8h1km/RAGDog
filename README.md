# RAGDog

RAGDog is a full-stack RAG observability app that lets you:

- upload a PDF
- index it into a Chroma vector store
- chat over the document
- inspect retrieval and generation telemetry in real time

The frontend is a Next.js dashboard, and the backend is a FastAPI service using LangChain, Chroma, HuggingFace embeddings, and Groq for LLM inference.

## What it does

1. You upload a PDF from the UI.
2. The backend chunks the document and embeds each chunk with all-MiniLM-L6-v2.
3. Chunks are stored in a local Chroma persistent collection.
4. For each question, the backend retrieves top chunks, removes near-duplicates, and sends context to the model.
5. The UI renders:
	 - answer text
	 - total, retrieval, and generation latency
	 - token usage
	 - chunk relevance scores and quality indicators

## Tech stack

### Client

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- Recharts (observability charts)
- Axios (API calls)
- lucide-react (icons)

### Server

- FastAPI + Uvicorn
- LangChain ecosystem:
	- langchain-community (PDF loading)
	- langchain-text-splitters
	- langchain-huggingface
	- langchain-chroma
	- langchain-groq
- ChromaDB (persistent local vector DB)
- HuggingFace model: all-MiniLM-L6-v2
- Groq model: llama-3.1-8b-instant

## Repository layout

```text
.
|-- client/              # Next.js observability dashboard
|-- server/              # FastAPI RAG service
|   |-- app.py           # API endpoints
|   |-- ingest.py        # PDF ingest pipeline
|   |-- query.py         # retrieval + generation logic
|   |-- main.py          # uvicorn runner
|   |-- chroma_db/       # local persisted vector data
|   `-- vectorstore/     # local FAISS artifacts (legacy/auxiliary)
`-- README.md
```

## Prerequisites

- Node.js 20+
- npm
- Python 3.12+

## Local setup

### 1) Server setup

From the repository root:

```powershell
cd server
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install fastapi uvicorn python-multipart langchain-community langchain-text-splitters langchain-huggingface langchain-chroma chromadb python-dotenv langchain-groq pypdf sentence-transformers
```

Create server environment variables in server/.env:

```env
GROQ_API_KEY=your_groq_api_key
HOST=0.0.0.0
PORT=8000
RELOAD=true
```

Start the API:

```powershell
python main.py
```

Backend default URL: http://127.0.0.1:8000

### 2) Client setup

Open a new terminal from the repository root:

```powershell
cd client
npm install
```

Optional client environment variable in client/.env.local:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

If not set, the client already defaults to http://127.0.0.1:8000.

Start the client:

```powershell
npm run dev
```

Frontend URL: http://localhost:3000

## API endpoints

### GET /health

Health check.

Response:

```json
{ "status": "ok" }
```

### POST /ingest

Accepts multipart/form-data with one field:

- file: PDF file

Behavior:

- rejects non-PDF uploads
- chunks and embeds the file
- recreates the collection before ingesting (previous indexed content is replaced)

### POST /query

Request:

```json
{ "question": "What is this document about?" }
```

Returns answer plus observability metrics.

### POST /chat

Request:

```json
{
	"question": "Summarize section 2",
	"history": [
		{ "role": "user", "content": "Hi" },
		{ "role": "assistant", "content": "Hello" }
	]
}
```

Response fields include:

- answer
- latency_ms
- retrieval_ms
- generation_ms
- input_tokens
- output_tokens
- chunks_retrieved
- chunks_used
- chunk_scores
- avg_chunk_score
- score_spread
- min_chunk_score
- max_chunk_score

## Observability notes

- Chunk scores are shown in the UI and used to color retrieval quality.
- Lower distance scores are treated as stronger retrieval matches.
- Sidebar charts and query history provide quick quality/performance trends.

## Typical dev workflow

1. Start backend (server terminal).
2. Start frontend (client terminal).
3. Upload a PDF in the UI.
4. Ask questions and inspect metrics/chunk relevance in the observability panel.

## Troubleshooting

- 400 Only PDF files are supported: upload a .pdf file only.
- 400 Question cannot be empty: send a non-empty question.
- 500 from /chat or /query:
	- confirm GROQ_API_KEY is set in server/.env
	- confirm server is running on the expected host/port
- No retrieval results or weak answers:
	- ingest the PDF again
	- verify chunks were ingested successfully

## Current behavior caveat

Ingestion currently recreates the collection each time. This means each new ingest replaces the previous indexed corpus instead of appending to it.
