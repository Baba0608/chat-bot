"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useRef, useEffect } from "react";

export default function Home() {
  const { messages, sendMessage, status, error, stop } = useChat({
    // Cast needed when pnpm hoists multiple 'ai' versions; runtime uses ai@6
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loading = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-screen flex-col bg-stone-100 dark:bg-stone-950">
      <header className="shrink-0 border-b border-stone-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/80">
        <h1 className="text-lg font-semibold tracking-tight text-stone-800 dark:text-stone-100">
          Chat
        </h1>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Powered by Llama 3.1 (local) · AI SDK
        </p>
      </header>

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
    </div>
  );
}
