"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useMemo } from "react";

const THREAD_SEARCH_PARAM = "thread";

export type ThreadItem = { id: string; title: string };

async function fetchChats(): Promise<ThreadItem[]> {
  const res = await fetch("/api/chats");
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function getLastUserMessageText(messages: { parts: { type: string; text?: string }[] }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.parts) {
      const text = msg.parts
        .filter((p): p is { type: string; text: string } => p?.type === "text" && typeof (p as { text?: string }).text === "string")
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) return text.slice(0, 80);
    }
  }
  return "New chat";
}

function ChatArea({
  threadId,
  onThreadCreated,
  onThreadIdInUrl,
}: {
  threadId: string | null;
  onThreadCreated: (id: string, title: string) => void;
  onThreadIdInUrl?: (id: string) => void;
}) {
  const pendingTitleRef = useRef<string>("New chat");
  const onThreadCreatedRef = useRef(onThreadCreated);
  onThreadCreatedRef.current = onThreadCreated;
  const onThreadIdInUrlRef = useRef(onThreadIdInUrl);
  onThreadIdInUrlRef.current = onThreadIdInUrl;
  // When we get a new thread id from the server, we must not change the component key
  // (so we don't remount and lose the streamed response). Use this ref for subsequent requests.
  const serverThreadIdRef = useRef<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => {
          const lastText = getLastUserMessageText(messages as { parts: { type: string; text?: string }[] }[]);
          pendingTitleRef.current = lastText || "New chat";
          const effectiveThreadId = threadId ?? serverThreadIdRef.current;
          return {
            body: {
              ...(typeof body === "object" && body !== null ? body : {}),
              messages,
              ...(effectiveThreadId ? { threadId: effectiveThreadId } : {}),
            },
          };
        },
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const newThreadId = res.headers.get("x-thread-id");
          if (newThreadId) {
            serverThreadIdRef.current = newThreadId;
            const title = pendingTitleRef.current || "New chat";
            onThreadCreatedRef.current(newThreadId, title);
            onThreadIdInUrlRef.current?.(newThreadId);
          }
          return res;
        },
      }),
    [threadId]
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loading = status === "submitted" || status === "streaming";

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center dark:border-stone-700 dark:bg-stone-900/50">
              <p className="text-stone-500 dark:text-stone-400">
                Send a message to start. Llama 3.1 is running locally.
              </p>
            </div>
          )}
          {messages.map(
            (message: {
              id: string;
              role: string;
              parts: { type: string; text?: string }[];
            }) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-stone-800 px-4 py-3 text-stone-100 dark:bg-stone-700"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 text-stone-800 shadow-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                }
              >
                <p className="whitespace-pre-wrap wrap-break-word text-[15px] leading-relaxed">
                  {message.parts
                    .filter(
                      (part: {
                        type: string;
                        text?: string;
                      }): part is { type: "text"; text: string } =>
                        part.type === "text"
                    )
                    .map((part: { type: "text"; text: string }) => part.text)
                    .join("")}
                </p>
              </div>
            )
          )}
          {loading && status === "submitted" && (
            <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 dark:border-stone-700 dark:bg-stone-800">
              <span className="inline-flex gap-1 text-stone-500 dark:text-stone-400">
                <span className="size-2 animate-pulse rounded-full bg-stone-400" />
                <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0.2s]" />
                <span className="size-2 animate-pulse rounded-full bg-stone-400 [animation-delay:0.4s]" />
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-2">
          <p className="mx-auto max-w-2xl rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
            Something went wrong.
          </p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && status === "ready") {
            sendMessage({ text: input.trim() });
            setInput("");
          }
        }}
        className="shrink-0 border-t border-stone-200 bg-white/80 px-4 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-900/80"
      >
        <div className="mx-auto flex max-w-2xl gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && status === "ready") {
                  sendMessage({ text: input.trim() });
                  setInput("");
                }
              }
            }}
            placeholder="Message…"
            disabled={status !== "ready"}
            className="flex-1 rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-[15px] text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-500/20 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:border-stone-500"
          />
          {loading ? (
            <button
              type="button"
              onClick={() => stop()}
              className="rounded-xl border border-stone-300 bg-stone-100 px-5 py-3 font-medium text-stone-700 transition hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() || status !== "ready"}
              className="rounded-xl bg-stone-800 px-5 py-3 font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-600 dark:hover:bg-stone-500"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export default function Home() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(() => {
    const t = searchParams.get(THREAD_SEARCH_PARAM);
    return t === "" || t === null ? null : t;
  });

  useEffect(() => {
    let cancelled = false;
    fetchChats().then((list) => {
      if (!cancelled) setThreads(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync state from URL on popstate (back/forward) so the sidebar selection matches the URL
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get(THREAD_SEARCH_PARAM);
      setCurrentThreadId(t === "" || t === null ? null : t);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const setThreadInUrl = (id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set(THREAD_SEARCH_PARAM, id);
    } else {
      params.delete(THREAD_SEARCH_PARAM);
    }
    const query = params.toString();
    const path = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    router.replace(path, { scroll: false });
  };

  const handleThreadCreated = (id: string, title: string) => {
    // Only add the thread to the sidebar; do NOT set currentThreadId here.
    // Otherwise the ChatArea key would change, remounting the component and
    // wiping the streamed response before it can be displayed.
    fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: id, title }),
    }).catch(() => {});
    setThreads((prev) => {
      const next = [{ id, title }, ...prev.filter((t) => t.id !== id)];
      return next;
    });
  };

  const handleThreadIdInUrl = (id: string) => {
    setThreadInUrl(id);
  };

  const startNewChat = () => {
    setCurrentThreadId(null);
    setThreadInUrl(null);
  };

  const selectThread = (id: string) => {
    setCurrentThreadId(id);
    setThreadInUrl(id);
  };

  return (
    <div className="flex h-screen bg-stone-100 dark:bg-stone-950">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center gap-2 border-b border-stone-200 p-3 dark:border-stone-800">
          <button
            type="button"
            onClick={startNewChat}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            <span aria-hidden>+</span>
            New chat
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => selectThread(thread.id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
                    currentThreadId === thread.id
                      ? "bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                  }`}
                >
                  <span className="line-clamp-2 block truncate">{thread.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Main chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-stone-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/80">
          <h1 className="text-lg font-semibold tracking-tight text-stone-800 dark:text-stone-100">
            Chat
          </h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Powered by Llama 3.1 (local) · AI SDK
          </p>
        </header>

        <ChatArea
          key={currentThreadId ?? "new"}
          threadId={currentThreadId}
          onThreadCreated={handleThreadCreated}
          onThreadIdInUrl={handleThreadIdInUrl}
        />
      </div>
    </div>
  );
}
