"use client";

import axios from "axios";
import { useMemo, useRef, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  SearchCheck,
  SendHorizontal,
  Sparkles,
  Timer,
  Upload,
  User,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChunkScore = {
  content: string;
  score: number;
  metadata?: {
    page?: number;
    [key: string]: unknown;
  };
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  latency_ms?: number;
  retrieval_ms?: number;
  generation_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  chunk_scores?: ChunkScore[];
  chunks_retrieved?: number;
  chunks_used?: number;
  avg_chunk_score?: number;
  score_spread?: number;
};

type ChatResponse = {
  answer: string;
  latency_ms: number;
  retrieval_ms: number;
  generation_ms: number;
  input_tokens: number;
  output_tokens: number;
  chunks_retrieved: number;
  chunks_used: number;
  avg_chunk_score: number;
  score_spread: number;
  chunk_scores: ChunkScore[];
};

type QueryHistoryItem = {
  id: string;
  question: string;
  latency_ms: number;
  avg_chunk_score: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

function scoreColor(score: number): string {
  if (score <= 0.8) return "#4ade80";   // strong
  if (score <= 1.2) return "#fbbf24";   // ok
  return "#f87171";                      // weak
}

function avgScoreColorClass(score: number): string {
  if (score < 1) return "text-emerald-300";
  if (score > 1.2) return "text-rose-300";
  return "text-amber-300";
}

function formatInt(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function ScoreBar({ score }: { score: number }) {
  const color = scoreColor(score);
  const pct = Math.min(score * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums" style={{ color }}>
        {score.toFixed(4)}
      </span>
    </div>
  );
}

export default function Home() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeMsg, setActiveMsg] = useState<ChatMessage | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [ingestInfo, setIngestInfo] = useState<{ pages: number; chunks: number } | null>(null);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const latestObservable = activeMsg ?? messages.filter(m => m.role === "assistant").at(-1) ?? null;

  const chartData = useMemo(() => {
    if (!latestObservable?.chunk_scores) return [];
    return latestObservable.chunk_scores.map((c, i) => ({
      index: `C${i + 1}`,
      score: Number.isFinite(c.score) ? c.score : 0,
    }));
  }, [latestObservable]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isQuerying]);

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!pdfFile) { setErrorMessage("Choose a PDF first."); return; }
    setIsIngesting(true);
    setErrorMessage("");
    try {
      const fd = new FormData();
      fd.append("file", pdfFile);
      const res = await axios.post(`${API_BASE}/ingest`, fd);
      const pages = res.data?.documents_loaded ?? "?";
      const chunks = res.data?.chunks_ingested ?? "?";
      setIngestInfo({ pages, chunks });
      setPdfName(pdfFile.name);
      setShowUploadModal(true);
    } catch (err) {
      setErrorMessage(axios.isAxiosError(err) ? (err.response?.data?.detail ?? "Ingest failed.") : "Ingest failed.");
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleChat(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isQuerying) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setQuestion("");
    setIsQuerying(true);
    setErrorMessage("");

    const history = updatedMessages
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await axios.post<ChatResponse>(`${API_BASE}/chat`, {
        question: trimmed,
        history: history.slice(0, -1),
      });
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.data.answer,
        latency_ms: res.data.latency_ms,
        retrieval_ms: res.data.retrieval_ms,
        generation_ms: res.data.generation_ms,
        input_tokens: res.data.input_tokens,
        output_tokens: res.data.output_tokens,
        chunk_scores: res.data.chunk_scores,
        chunks_retrieved: res.data.chunks_retrieved,
        chunks_used: res.data.chunks_used,
        avg_chunk_score: res.data.avg_chunk_score,
        score_spread: res.data.score_spread,
      };
      setMessages(prev => [...prev, assistantMsg]);
      setQueryHistory(prev => {
        const next = [
          {
            id: `${Date.now()}`,
            question: trimmed,
            latency_ms: res.data.latency_ms,
            avg_chunk_score: res.data.avg_chunk_score,
          },
          ...prev,
        ];
        return next.slice(0, 10);
      });
      setActiveMsg(null);
    } catch (err) {
      setErrorMessage(axios.isAxiosError(err) ? (err.response?.data?.detail ?? "Query failed.") : "Query failed.");
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsQuerying(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChat();
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[radial-gradient(circle_at_22%_-10%,#2e1065_0,#09090b_45%,#040406_100%)] text-white" style={{ fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif" }}>
      <header className="flex-none flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/6 bg-black/20 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center shadow-lg shadow-fuchsia-900/30">
            <Sparkles size={16} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-fuchsia-500">RAG Observability</p>
            <p className="text-[11px] text-white/35">Conversational retrieval cockpit</p>
          </div>
          {pdfName ? (
            <span className="hidden md:flex items-center gap-1.5 text-xs text-white/55 bg-white/5 px-2.5 py-1 rounded-full border border-white/8">
              <FileText size={12} />
              {pdfName}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <form onSubmit={handleIngest} className="flex items-center gap-2">
            <label className="relative cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                className="absolute inset-0 opacity-0 w-full cursor-pointer"
                onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-1.5 text-xs font-medium text-white/60 bg-white/5 hover:bg-white/8 border border-white/8 px-3 py-1.5 rounded-xl transition-colors">
                <Upload size={12} />
                {pdfFile ? `${pdfFile.name.slice(0, 16)}...` : "Choose PDF"}
              </div>
            </label>
            <button
              type="submit"
              disabled={isIngesting || !pdfFile}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isIngesting ? "Ingesting..." : "Ingest"}
            </button>
          </form>
          <div className="w-px h-4 bg-white/10" />
          <button
            onClick={() => setSidebarOpen(p => !p)}
            className="flex items-center gap-1.5 text-xs font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/8 border border-white/8 px-3 py-1.5 rounded-xl transition-colors"
          >
            {sidebarOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}
            {sidebarOpen ? "Hide" : "Observability"}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10">
            {messages.length === 0 && !isQuerying ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4 select-none">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-fuchsia-500/25 to-violet-600/20 border border-fuchsia-400/20 flex items-center justify-center mb-4 animate-[pulse_4s_ease-in-out_infinite]">
                  <MessageSquare size={24} className="text-fuchsia-200/80" />
                </div>
                <p className="text-white/45 text-sm font-medium">Upload a PDF and ask your first question</p>
                <p className="text-white/25 text-xs mt-1">You will see retrieval quality and latency in real time</p>
              </div>
            ) : null}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" ? (
                  <div className="flex-none w-7 h-7 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center mt-0.5 shadow-md shadow-fuchsia-900/20">
                    <Bot size={14} />
                  </div>
                ) : null}

                <div className={`group max-w-[78%] ${msg.role === "user" ? "order-first" : ""}`}>
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed border ${msg.role === "user"
                      ? "bg-violet-600/20 border-violet-500/30 text-white/95 rounded-tr-sm"
                      : "bg-white/4 border-white/8 text-white/85 rounded-tl-sm"
                      }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  {msg.role === "assistant" && msg.latency_ms !== undefined ? (
                    <div className="flex items-center gap-3 mt-1.5 px-1 flex-wrap">
                      <span className="text-[10px] text-white/30 font-mono">{msg.latency_ms}ms</span>
                      {msg.input_tokens !== undefined && msg.output_tokens !== undefined ? (
                        <span className="text-[10px] text-white/35 font-mono">
                          In {formatInt(msg.input_tokens)} · Out {formatInt(msg.output_tokens)}
                        </span>
                      ) : null}
                      {msg.chunk_scores ? (
                        <button
                          onClick={() => setActiveMsg(activeMsg === msg ? null : msg)}
                          className="inline-flex items-center gap-1 text-[10px] text-fuchsia-300/70 hover:text-fuchsia-200 transition-colors"
                        >
                          {activeMsg === msg ? "hide chunks" : `${msg.chunks_retrieved} chunks`}
                          <ChevronRight size={10} className={activeMsg === msg ? "rotate-90 transition-transform" : "transition-transform"} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {msg.role === "user" ? (
                  <div className="flex-none w-7 h-7 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center mt-0.5 text-white/55">
                    <User size={14} />
                  </div>
                ) : null}
              </div>
            ))}

            {isQuerying ? (
              <div className="flex gap-3 justify-start">
                <div className="flex-none w-7 h-7 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center mt-0.5">
                  <Bot size={14} />
                </div>
                <div className="bg-white/4 border border-white/8 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-white/60">
                  <LoaderCircle size={14} className="animate-spin" />
                  Thinking...
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {errorMessage ? (
            <div className="flex-none mx-4 sm:mx-6 mb-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-200 flex items-center gap-2">
              <Activity size={14} />
              {errorMessage}
            </div>
          ) : null}

          <div className="flex-none px-4 sm:px-6 pb-4">
            <form onSubmit={handleChat} className="flex items-end gap-2 rounded-2xl border border-white/10 bg-white/4 p-2 focus-within:border-fuchsia-400/50 transition-colors">
              <textarea
                ref={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about the document..."
                rows={1}
                style={{ resize: "none", minHeight: "36px", maxHeight: "120px" }}
                className="flex-1 bg-transparent text-sm text-white/85 placeholder-white/30 outline-none px-2 py-1.5 leading-relaxed"
              />
              <button
                type="submit"
                disabled={isQuerying || !question.trim()}
                className="flex-none w-9 h-9 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                <SendHorizontal size={14} />
              </button>
            </form>
            <p className="text-center text-[10px] text-white/25 mt-2">Enter to send · Shift+Enter for new line · Context preserved per session</p>
          </div>
        </main>

        <aside className={`flex-none flex flex-col border-l border-white/6 bg-black/25 backdrop-blur-xl transition-all duration-300 overflow-hidden ${sidebarOpen ? "w-80 xl:w-96" : "w-0"}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-80 xl:min-w-96">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Observability</span>
              {latestObservable ? <span className="text-[10px] text-white/25">last query</span> : null}
            </div>

            {/* Latency */}
            <div className="rounded-xl border border-white/8 bg-white/4 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Latency</p>
              {latestObservable?.latency_ms !== undefined ? (
                <div className="flex items-baseline gap-1.5">
                  <Timer size={15} className="text-amber-300 mb-1" />
                  <span className="text-3xl font-black tabular-nums text-amber-300">{latestObservable.latency_ms}</span>
                  <span className="text-sm text-amber-300/60 font-medium">ms</span>
                </div>
              ) : (
                <span className="text-2xl font-black text-white/10">--</span>
              )}
              {latestObservable ? (
                <p className="mt-2 text-[10px] text-white/35 font-mono">
                  Input: {formatInt(latestObservable.input_tokens)} tokens · Output: {formatInt(latestObservable.output_tokens)} tokens
                </p>
              ) : null}
            </div>

            <div className="rounded-xl border border-white/8 bg-white/4 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Pipeline Split</p>
              {latestObservable ? (
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-white/35">Retrieval</p>
                    <SearchCheck size={13} className="text-cyan-300 mb-1" />
                    <p className="text-cyan-300 font-semibold tabular-nums">{latestObservable.retrieval_ms ?? 0} ms</p>
                  </div>
                  <div className="w-px h-7 bg-white/10" />
                  <div className="text-right">
                    <p className="text-white/35">Generation</p>
                    <Bot size={13} className="text-fuchsia-300 mb-1 ml-auto" />
                    <p className="text-fuchsia-300 font-semibold tabular-nums">{latestObservable.generation_ms ?? 0} ms</p>
                  </div>
                </div>
              ) : (
                <span className="text-sm text-white/20">--</span>
              )}
            </div>

            <div className="rounded-xl border border-white/8 bg-white/4 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Retrieval Quality</p>
              {latestObservable ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/35">Average score</span>
                    <span className={`text-sm font-bold tabular-nums ${avgScoreColorClass(latestObservable.avg_chunk_score ?? 0)}`}>
                      {latestObservable.avg_chunk_score?.toFixed(4) ?? "0.0000"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/35">Score spread</span>
                    <span className="text-xs text-white/70 font-mono">{latestObservable.score_spread?.toFixed(4) ?? "0.0000"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/35">Chunks</span>
                    <span className="text-xs text-white/70 font-mono">
                      Retrieved {latestObservable.chunks_retrieved ?? 0} · Used {latestObservable.chunks_used ?? 0}
                    </span>
                  </div>
                </div>
              ) : (
                <span className="text-sm text-white/20">--</span>
              )}
            </div>

            {/* Chart */}
            <div className="rounded-xl border border-white/8 bg-white/4 p-4">
              <p className="text-[10px] uppercase tracking-widest text-white/30 mb-3">Chunk Relevance</p>
              <div className="h-44">
                {isQuerying ? (
                  <div className="flex h-full items-end gap-2 animate-pulse">
                    {[45, 72, 35, 60].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-md bg-white/10" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="index" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 1]} />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        contentStyle={{ backgroundColor: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "#f4f4f5", fontSize: 11 }}
                      />
                      <Bar dataKey="score" radius={[5, 5, 0, 0]}>
                        {chartData.map(p => <Cell key={p.index} fill={scoreColor(p.score)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-white/20">
                    No data yet
                  </div>
                )}
              </div>
              {/* Legend */}
              <div className="flex items-center gap-3 mt-3">
                {[["#4ade80", "≤0.8 strong"], ["#fbbf24", "≤1.2 ok"], ["#f87171", ">1.2 weak"]].map(([c, l]) => (
                  <div key={l} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                    <span className="text-[9px] text-white/25">{l}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-white/30 inline-flex items-center gap-1.5">
                <Activity size={12} />
                Recent Queries
              </p>
              {queryHistory.length > 0 ? (
                <div className="rounded-xl border border-white/8 bg-white/4 p-3 space-y-2">
                  {queryHistory.slice(0, 5).map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-[10px]">
                      <p className="text-white/45 truncate">{item.question}</p>
                      <div className="flex items-center gap-2 shrink-0 font-mono">
                        <span className="text-cyan-300">{item.latency_ms.toFixed(0)}ms</span>
                        <span className={avgScoreColorClass(item.avg_chunk_score)}>{item.avg_chunk_score.toFixed(3)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/8 p-3 text-[10px] text-white/25 text-center">
                  No queries yet
                </div>
              )}

              <p className="text-[10px] uppercase tracking-widest text-white/30 inline-flex items-center gap-1.5">
                <FileText size={12} />
                Retrieved Chunks
                {latestObservable?.chunks_retrieved !== undefined && (
                  <span className="ml-1.5 text-white/20">
                    ({latestObservable.chunks_used ?? 0}/{latestObservable.chunks_retrieved})
                  </span>
                )}
              </p>
              {isQuerying ? (
                <div className="space-y-2 animate-pulse">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-xl border border-white/6 bg-white/2 p-3 space-y-2">
                      <div className="h-2.5 w-1/3 rounded bg-white/10" />
                      <div className="h-2.5 w-full rounded bg-white/7" />
                      <div className="h-2.5 w-4/5 rounded bg-white/7" />
                    </div>
                  ))}
                </div>
              ) : latestObservable?.chunk_scores?.length ? (
                latestObservable.chunk_scores.map((chunk, i) => {
                  const page = typeof chunk.metadata?.page === "number" ? chunk.metadata.page + 1 : "?";
                  return (
                    <div key={i} className="rounded-xl border border-white/6 bg-white/2 hover:bg-white/4 transition-colors p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Chunk {i + 1}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-white/25 bg-white/5 px-1.5 py-0.5 rounded-md">
                          <FileText size={10} />
                          pg {page}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-white/50 mb-2 line-clamp-3">{chunk.content}</p>
                      <ScoreBar score={chunk.score} />
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-white/8 p-4 text-xs text-white/20 text-center inline-flex items-center justify-center gap-2 w-full">
                  <SearchCheck size={13} />
                  Send a message to see retrieved chunks
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {showUploadModal && ingestInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#13131f] p-6 shadow-2xl">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mb-4">
              <CheckCircle2 size={18} className="text-emerald-300" />
            </div>
            <h3 className="text-lg font-bold text-white/90 mb-1">PDF ingested</h3>
            <p className="text-sm text-white/40 mb-4">
              Loaded <span className="text-white/70 font-medium">{ingestInfo.pages}</span> pages into <span className="text-white/70 font-medium">{ingestInfo.chunks}</span> chunks.
            </p>
            <button
              onClick={() => setShowUploadModal(false)}
              className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors py-2.5 text-sm font-semibold text-white"
            >
              <span className="inline-flex items-center gap-2">
                Start chatting
                <SendHorizontal size={14} />
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}