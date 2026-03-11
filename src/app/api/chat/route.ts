import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse, UIMessage } from "ai";
import { agent } from "@/lib/deep-agent";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const langchainMessages = await toBaseMessages(messages);

  const stream = await agent.stream(
    { messages: langchainMessages },
    { streamMode: ["values", "messages"] }
  );

  return createUIMessageStreamResponse({
    stream: toUIMessageStream(stream),
  });
}
