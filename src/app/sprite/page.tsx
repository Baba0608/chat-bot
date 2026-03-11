"use client";

import { useState } from "react";

type ApiError = {
  error: string;
};

export default function SpritePage() {
  const [output, setOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runSprite() {
    setLoading(true);
    setError(null);
    setOutput("");
    try {
      const res = await fetch("/api/sprite", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        setError(data.error ?? "Request failed");
        return;
      }
      if (!res.body) {
        setOutput("(no output)");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setOutput(text);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run sprite");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-100 dark:bg-stone-950">
      <header className="shrink-0 border-b border-stone-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-stone-800 dark:bg-stone-900/80">
        <h1 className="text-lg font-semibold tracking-tight text-stone-800 dark:text-stone-100">
          Sprite
        </h1>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Create and run a Fly Sprite container
        </p>
      </header>

      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <button
            type="button"
            onClick={runSprite}
            disabled={loading}
            className="rounded-xl bg-stone-800 px-5 py-3 font-medium text-white transition hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-600 dark:hover:bg-stone-500"
          >
            {loading ? "Running…" : "Create & run sprite"}
          </button>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          {(output || loading) && (
            <div className="rounded-xl border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
              <div className="border-b border-stone-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Output
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-sm text-stone-800 dark:text-stone-100">
                {output || (loading ? "…" : "(no output)")}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
