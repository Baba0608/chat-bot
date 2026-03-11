import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, DynamicTool } from "langchain";

const ollamaModel = new ChatOllama({
  model: process.env.OLLAMA_MODEL ?? "llama3.1:latest",
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  temperature: 0,
});

const openaiModel = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a helpful assistant that can answer questions and help with tasks.
You are good at rephrasing the sentence in simple words. and make sentence more clear and concise.`;

const randomNumberTool = new DynamicTool({
  name: "random_number",
  description: "Generate a random number",
  func: async () => {
    const randomNumber = Math.random();
    console.log("Generating random number", randomNumber);
    return String(randomNumber);
  },
});

export const agent = createAgent({
  model: openaiModel,
  systemPrompt: SYSTEM_PROMPT,
  tools: [randomNumberTool],
});
