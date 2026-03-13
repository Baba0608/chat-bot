import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/chats – list chats from DB, ordered by most recently updated.
 * Returns { id: threadId, title }[] for use in the sidebar (id is LangGraph thread_id).
 */
export async function GET() {
  try {
    const chats = await prisma.chat.findMany({
      orderBy: { updatedAt: "desc" },
      select: { threadId: true, title: true },
    });
    const threads = chats.map((c) => ({ id: c.threadId, title: c.title }));
    return NextResponse.json(threads);
  } catch (e) {
    console.error("GET /api/chats:", e);
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chats – create or update a chat when a new thread is created.
 * Body: { threadId: string, title: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { threadId, title } = body as { threadId?: string; title?: string };
    if (typeof threadId !== "string" || !threadId.trim()) {
      return NextResponse.json(
        { error: "threadId is required" },
        { status: 400 }
      );
    }
    const chat = await prisma.chat.upsert({
      where: { threadId: threadId.trim() },
      create: { threadId: threadId.trim(), title: typeof title === "string" ? title.trim() || "New chat" : "New chat" },
      update: { title: typeof title === "string" ? title.trim() || "New chat" : "New chat" },
    });
    return NextResponse.json({ id: chat.threadId, title: chat.title });
  } catch (e) {
    console.error("POST /api/chats:", e);
    return NextResponse.json(
      { error: "Failed to save chat" },
      { status: 500 }
    );
  }
}
