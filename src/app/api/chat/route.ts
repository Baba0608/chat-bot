import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, UIMessage } from "ai";
import { agent } from "@/lib/deep-agent";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const graph = agent;

  const langchainMessages = await toBaseMessages(messages);

  const stream = await graph.stream(
    { messages: langchainMessages },
    { streamMode: ["values", "messages"] }
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream),
  });
}
