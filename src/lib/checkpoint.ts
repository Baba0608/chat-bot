/**
 * Persist and load LangGraph-style checkpoints using the existing
 * checkpoint tables (Checkpoint, CheckpointBlob, CheckpointWrite).
 * The agent runs in a sandbox without DB access; we save state from the stream here.
 */

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const globalForCheckpointer = globalThis as unknown as {
  checkpointer: PostgresSaver | undefined;
};

function getCheckpointer(): PostgresSaver {
  if (globalForCheckpointer.checkpointer) {
    return globalForCheckpointer.checkpointer;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for checkpoint persistence");
  }
  const checkpointer = PostgresSaver.fromConnString(url);
  if (process.env.NODE_ENV !== "production") {
    globalForCheckpointer.checkpointer = checkpointer;
  }
  return checkpointer;
}

let setupPromise: Promise<void> | null = null;

async function ensureSetup(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = getCheckpointer().setup();
  return setupPromise;
}

/**
 * Build a checkpoint object in the format LangGraph expects (same as PostgresSaver.put).
 * channel_values = the "values" payload from the stream (e.g. { messages: [...] }).
 */
function buildCheckpoint(channelValues: Record<string, unknown>) {
  const channelNames = Object.keys(channelValues);
  const channel_versions: Record<string, number> = { __start__: 1 };
  channelNames.forEach((name, i) => {
    channel_versions[name] = i + 2;
  });
  return {
    v: 1,
    ts: new Date().toISOString(),
    id: crypto.randomUUID(),
    channel_values: channelValues,
    channel_versions,
    versions_seen: {} as Record<string, Record<string, number>>,
    pending_sends: [],
  };
}

/**
 * Save stream "values" payload to the checkpoint tables (same logic as LangGraph PostgresSaver).
 * Call this when we receive a "values" event from the agent stream.
 */
export async function saveCheckpoint(
  threadId: string,
  channelValues: Record<string, unknown>
): Promise<void> {
  if (Object.keys(channelValues).length === 0) return;
  await ensureSetup();
  const checkpointer = getCheckpointer();
  const config = {
    configurable: { thread_id: threadId, checkpoint_ns: "" },
  };
  const checkpoint = buildCheckpoint(channelValues);
  const newVersions: Record<string, number> = {};
  for (const name of Object.keys(checkpoint.channel_values)) {
    newVersions[name] = checkpoint.channel_versions[name] ?? 1;
  }
  const metadata = { source: "loop" as const, step: 0, parents: {} as Record<string, string> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await checkpointer.put(config, checkpoint as any, metadata, newVersions);
}

/**
 * Load the latest checkpoint for a thread and return channel_values (e.g. { messages }).
 * Returns null if no checkpoint exists.
 */
export async function getCheckpoint(
  threadId: string
): Promise<Record<string, unknown> | null> {
  await ensureSetup();
  const checkpointer = getCheckpointer();
  const config = { configurable: { thread_id: threadId } };
  const result = await checkpointer.get(config) as unknown;
  const checkpoint =
    result && typeof result === "object" && "channel_values" in result
      ? (result as { channel_values: Record<string, unknown> })
      : (result as { checkpoint?: { channel_values?: Record<string, unknown> } })?.checkpoint;
  if (!checkpoint?.channel_values) return null;
  return checkpoint.channel_values;
}
