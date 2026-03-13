import { toBaseMessages } from "@ai-sdk/langchain";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
} from "ai";
import { saveCheckpoint } from "@/lib/checkpoint";
import {
  consumeLangGraphSSE,
  TEXT_ID,
  type StreamWriter,
} from "@/utils/langgraph";

const AGENT_SERVER_URL = "https://my-sprite-i4t.sprites.app";
const API_KEY =
  process.env.LANGSMITH_API_KEY ?? process.env.LANGGRAPH_API_KEY ?? "";
const ASSISTANT_ID = process.env.LANGGRAPH_ASSISTANT_ID ?? "my-agent";

export const maxDuration = 60;

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
      await consumeLangGraphSSE(rawStream, writer as StreamWriter, {
        onValues: (payload) => {
          if (threadId) {
            saveCheckpoint(threadId, payload).catch(() => {});
          }
        },
      });
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
