import { toBaseMessages } from "@ai-sdk/langchain";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
} from "ai";
import { saveCheckpoint } from "@/lib/checkpoint";
import { prisma } from "@/lib/db";
import { createAndSetupSprite } from "@/lib/sprite-setup";
import {
  consumeLangGraphSSE,
  TEXT_ID,
  type StreamWriter,
} from "@/utils/langgraph";

const API_KEY =
  process.env.LANGSMITH_API_KEY ?? process.env.LANGGRAPH_API_KEY ?? "";
const ASSISTANT_ID = process.env.LANGGRAPH_ASSISTANT_ID ?? "my-agent";

export const maxDuration = 120;

const headers = () => ({
  "Content-Type": "application/json",
  ...(API_KEY && { "x-api-key": API_KEY }),
});

const log = (msg: string, ...args: unknown[]) =>
  console.log("[chat]", msg, ...args);

async function ensureThreadAndSprite(
  body: any,
  existingThreadId?: string
): Promise<{ threadId: string; agentUrl: string }> {
  let threadId = existingThreadId;
  let agentUrl: string;

  if (threadId) {
    log("using existing thread", { threadId });
    const chat = await prisma.chat.findUnique({
      where: { threadId },
      select: { spriteUrl: true },
    });
    agentUrl = chat?.spriteUrl ?? "";
    if (!agentUrl) {
      throw new Error("No sprite URL found for existing thread");
    }
    log("resolved agent URL for existing thread", {
      threadId,
      agentUrl,
      fromDb: !!chat?.spriteUrl,
    });
    return { threadId, agentUrl };
  }

  // Create a new thread id first so we can embed it into the sprite name.
  const newThreadId = crypto.randomUUID();
  log("creating new thread and sprite", { newThreadId });

  const { spriteUrl } = await createAndSetupSprite(newThreadId);
  agentUrl = spriteUrl;
  log("sprite ready, creating thread on agent", { agentUrl });

  const createRes = await fetch(`${agentUrl}/threads`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      thread_id: newThreadId,
      metadata: body.metadata ?? {},
      if_exists: "raise",
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    log("thread creation failed", { status: createRes.status, err });
    throw new Error(`Failed to create thread: ${err}`);
  }

  const created = await createRes.json().catch(() => ({}));
  const returnedThreadId = created.thread_id;
  if (typeof returnedThreadId !== "string" || !returnedThreadId) {
    throw new Error("Agent server did not return thread_id");
  }
  threadId = returnedThreadId;
  log("thread created on agent", { threadId });

  await prisma.chat.upsert({
    where: { threadId },
    create: {
      threadId,
      title: "New chat",
      spriteUrl: agentUrl,
    },
    update: { spriteUrl: agentUrl },
  });
  log("chat record upserted", { threadId, spriteUrl: agentUrl });

  return { threadId, agentUrl };
}

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
  let threadId: string;
  let agentUrl: string;

  log("POST /api/chat", {
    hasThreadId: !!existingThreadId,
    messageCount: messages.length,
  });

  try {
    const result = await ensureThreadAndSprite(body, existingThreadId);
    threadId = result.threadId;
    agentUrl = result.agentUrl;
    log("thread/agent ready, starting run stream", { threadId, agentUrl });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to ensure thread and sprite";
    log("ensureThreadAndSprite failed", { error: message });
    return Response.json({ error: message }, { status: 502 });
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

  const streamRes = await fetch(`${agentUrl}/threads/${threadId}/runs/stream`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(runCreateBody),
  });

  if (!streamRes.ok) {
    const err = await streamRes.text();
    log("stream run failed", { status: streamRes.status, err });
    return Response.json(
      { error: `Stream run failed: ${err}` },
      { status: streamRes.status }
    );
  }

  log("stream started", { threadId });
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
