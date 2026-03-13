import { getCheckpoint } from "@/lib/checkpoint";
import { getMessageContent } from "@/utils/langgraph";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type UIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: { type: "text"; text: string }[];
};

/** Returns [role, wasExplicit] – explicit means we found type/id, not defaulted. */
function getMessageRole(
  msg: Record<string, unknown>
): ["user" | "assistant" | "system", boolean] {
  const type = msg.type;
  const id = msg.id;
  if (type === "human") return ["user", true];
  if (type === "ai") return ["assistant", true];
  if (type === "system") return ["system", true];
  if (Array.isArray(id)) {
    const idStr = (id as string[]).join(" ").toLowerCase();
    if (idStr.includes("aimessage") || idStr.includes("aimessagechunk")) return ["assistant", true];
    if (idStr.includes("humanmessage")) return ["user", true];
    if (idStr.includes("systemmessage")) return ["system", true];
  }
  if (typeof id === "string" && id.toLowerCase().includes("ai")) return ["assistant", true];
  return ["user", false];
}

/** Extract text from serialized message; tries multiple shapes (kwargs.content, content, nested parts). */
function extractText(msg: unknown): string {
  const fromLanggraph = getMessageContent(msg);
  if (fromLanggraph.trim()) return fromLanggraph;
  if (msg == null || typeof msg !== "object") return "";
  const obj = msg as Record<string, unknown>;
  const kwargs = obj.kwargs as Record<string, unknown> | undefined;
  const content = (kwargs?.content ?? obj.content) as string | unknown[] | undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === "object" && "text" in c) return String((c as { text: string }).text);
        if (typeof c === "string") return c;
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * Convert LangGraph/LangChain checkpoint messages to AI SDK UIMessage format.
 * Handles serialized forms: type/id + kwargs.content or content.
 */
function checkpointMessagesToUIMessages(messages: unknown[]): UIMessage[] {
  const result: UIMessage[] = [];
  let lastRole: "user" | "assistant" | "system" = "user";
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg == null || typeof msg !== "object") continue;
    const obj = msg as Record<string, unknown>;
    let [role, explicit] = getMessageRole(obj);
    const text = extractText(msg);
    if (text.trim() === "" && role === "user") continue;
    if (!explicit && lastRole === "user" && text.trim()) {
      role = "assistant";
    }
    lastRole = role;
    result.push({
      id: `msg-${i}-${Date.now()}`,
      role,
      parts: [{ type: "text" as const, text: text.trim() || " " }],
    });
  }
  return result;
}

/**
 * GET /api/chats/[threadId]/messages – load messages from checkpoint for a thread.
 * Returns UIMessage[] for use with useChat (e.g. setMessages or initial state).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await params;
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required" },
        { status: 400 }
      );
    }
    const channelValues = await getCheckpoint(threadId);
    if (!channelValues || !Array.isArray(channelValues.messages)) {
      return NextResponse.json([]);
    }
    const uiMessages = checkpointMessagesToUIMessages(channelValues.messages as unknown[]);
    return NextResponse.json(uiMessages);
  } catch (e) {
    console.error("GET /api/chats/[threadId]/messages:", e);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 }
    );
  }
}
