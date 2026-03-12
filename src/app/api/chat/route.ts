import { toBaseMessages } from "@ai-sdk/langchain";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
} from "ai";

const AGENT_SERVER_URL = "https://my-sprite-i4t.sprites.app";
const API_KEY =
  process.env.LANGSMITH_API_KEY ?? process.env.LANGGRAPH_API_KEY ?? "";
const ASSISTANT_ID = process.env.LANGGRAPH_ASSISTANT_ID ?? "my-agent";

export const maxDuration = 60;

const TEXT_ID = "assistant-text";

function getMessageContent(msg: unknown): string {
  if (msg == null || typeof msg !== "object") return "";
  const obj = msg as Record<string, unknown>;
  const src =
    obj.kwargs && typeof obj.kwargs === "object"
      ? (obj.kwargs as Record<string, unknown>)
      : obj;
  const content = src.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: string }).text)
          : ""
      )
      .join("");
  }
  return "";
}

function isAIMessage(msg: unknown): boolean {
  if (msg == null || typeof msg !== "object") return false;
  const obj = msg as Record<string, unknown>;
  if (obj.type === "ai") return true;
  if (obj.type === "constructor" && Array.isArray(obj.id)) {
    const id = obj.id as string[];
    return id.some((x) => x === "AIMessage" || x === "AIMessageChunk");
  }
  return false;
}

type StreamWriter = {
  write: (part: { type: string; id?: string; delta?: string }) => void;
};

async function consumeLangGraphSSE(
  byteStream: ReadableStream<Uint8Array>,
  writer: StreamWriter
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lastValuesData: Record<string, unknown> | null = null;
  let streamedText = "";

  const reader = byteStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let eventType = "values";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        // SSE spec: multiple data lines form one payload (server may split JSON across lines)
        const raw = dataLines.join("").trim();
        if (!raw || raw === "[DONE]") continue;

        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }

        const type =
          typeof data === "object" &&
          data !== null &&
          "type" in data &&
          "data" in data
            ? (data as { type: string }).type
            : eventType;
        let payload: unknown =
          typeof data === "object" &&
          data !== null &&
          "type" in data &&
          "data" in data
            ? (data as { data: unknown }).data
            : data;

        // Server may send payload as JSON string (e.g. values, messages/partial)
        if (typeof payload === "string" && payload.length > 0) {
          try {
            const parsed = JSON.parse(payload);
            payload = parsed;
          } catch {
            // keep as string for messages/partial text chunks
          }
        }

        // messages/partial = streaming chunks; payload is cumulative (full content so far)
        if (type === "messages/partial" || type === "messages/complete") {
          let fullContent = "";
          let isAI = false;
          if (typeof payload === "string") {
            fullContent = payload;
            isAI = true;
          } else if (Array.isArray(payload) && payload.length > 0) {
            const part = payload[0] as Record<string, unknown> | string;
            if (typeof part === "string") {
              fullContent = part;
              isAI = true;
            } else if (part && typeof part === "object") {
              isAI = (part.type as string) === "ai";
              fullContent =
                (part.content as string) ?? getMessageContent(part) ?? "";
            }
          } else if (payload && typeof payload === "object") {
            const obj = payload as Record<string, unknown>;
            isAI = (obj.type as string) === "ai";
            if (typeof obj.content === "string") fullContent = obj.content;
            else if (Array.isArray(obj.parts))
              fullContent = (obj.parts as { text?: string }[])
                .map((p) => p.text ?? "")
                .join("");
            else fullContent = getMessageContent(payload);
          }
          if (!isAI) continue;
          // Emit only the new part (delta) so the UI shows streaming, not repeated full text
          const delta = fullContent.slice(streamedText.length);
          if (delta) {
            streamedText = fullContent;
            writer.write({ type: "text-delta", id: TEXT_ID, delta });
          }
        } else if (type === "values" && payload && typeof payload === "object") {
          lastValuesData = payload as Record<string, unknown>;
          const messages = lastValuesData.messages;
          if (Array.isArray(messages)) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (isAIMessage(msg)) {
                const text = getMessageContent(msg);
                if (text && text !== streamedText) {
                  const delta = text.slice(streamedText.length);
                  if (delta) {
                    writer.write({ type: "text-delta", id: TEXT_ID, delta });
                  }
                  streamedText = text;
                }
                break;
              }
            }
          }
        } else if (type === "messages" && Array.isArray(payload)) {
          const [rawMsg] = payload;
          if (rawMsg && isAIMessage(rawMsg)) {
            const delta = getMessageContent(rawMsg);
            if (delta) {
              streamedText += delta;
              writer.write({ type: "text-delta", id: TEXT_ID, delta });
            }
          }
        }
      }
    }

    if (
      streamedText === "" &&
      lastValuesData?.messages &&
      Array.isArray(lastValuesData.messages)
    ) {
      for (let i = lastValuesData.messages.length - 1; i >= 0; i--) {
        const msg = lastValuesData.messages[i];
        if (isAIMessage(msg)) {
          streamedText = getMessageContent(msg);
          if (streamedText) {
            writer.write({
              type: "text-delta",
              id: TEXT_ID,
              delta: streamedText,
            });
          }
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const headers = () => ({
  "Content-Type": "application/json",
  ...(API_KEY && { "x-api-key": API_KEY }),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    messages,
    threadId: existingThreadId,
  }: { messages: UIMessage[]; threadId?: string } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "messages array is required" },
      { status: 400 }
    );
  }

  const langchainMessages = await toBaseMessages(messages);
  let threadId = existingThreadId;

  if (!threadId) {
    const createRes = await fetch(`${AGENT_SERVER_URL}/threads`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        thread_id: crypto.randomUUID(),
        metadata: body.metadata ?? {},
        if_exists: "raise",
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return Response.json(
        { error: `Failed to create thread: ${err}` },
        { status: createRes.status }
      );
    }

    const created = await createRes.json().catch(() => ({}));
    threadId = created.thread_id;
  }

  // Create run, stream output: POST /threads/{thread_id}/runs/stream
  // https://docs.langchain.com/langsmith/agent-server-api/thread-runs/create-run-stream-output
  const runCreateBody = {
    assistant_id: body.assistant_id ?? ASSISTANT_ID,
    input: { messages: langchainMessages },
    stream_mode: body.stream_mode ?? ["values", "messages"],
    ...(body.config != null && { config: body.config }),
    ...(body.context != null && { context: body.context }),
    ...(body.metadata != null && { metadata: body.metadata }),
    ...(body.checkpoint != null && { checkpoint: body.checkpoint }),
    ...(body.command != null && { command: body.command }),
  };

  const streamRes = await fetch(
    `${AGENT_SERVER_URL}/threads/${threadId}/runs/stream`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(runCreateBody),
    }
  );

  if (!streamRes.ok) {
    const err = await streamRes.text();
    return Response.json(
      { error: `Stream run failed: ${err}` },
      { status: streamRes.status }
    );
  }

  const rawStream = streamRes.body;
  if (!rawStream) {
    return Response.json({ error: "No response body" }, { status: 502 });
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: TEXT_ID });
      await consumeLangGraphSSE(rawStream, writer as StreamWriter);
      writer.write({ type: "text-end", id: TEXT_ID });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-thread-id": threadId ?? "",
    },
  });
}
