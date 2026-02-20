import OpenAI from "openai";
import { config } from "../config.js";
import type { AIProvider, AIResponse } from "./types.js";

const apiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY ?? "";

if (!apiKey) {
  console.warn("OPENAI_API_KEY not set; OpenAI provider will not be available.");
}

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (client === null && apiKey) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Expect AI to respond with "DECISION: X" and optional "REASONING: Y" */
function parseStructuredResponse(content: string): AIResponse {
  const decisionMatch = content.match(/DECISION:\s*(\w+)/i) ?? content.match(/(?:^|\n)\s*(\w+)\s*$/);
  const reasoningMatch = content.match(/REASONING:\s*([\s\S]+?)(?=\n\n|$)/i);
  return {
    decision: (decisionMatch?.[1] ?? content.split(/\s+/)[0] ?? "stand").toLowerCase(),
    reasoning: reasoningMatch?.[1]?.trim(),
  };
}

function createOpenAIProvider(id: string, name: string, model: string): AIProvider | null {
  const c = getClient();
  if (!c) return null;
  return {
    id,
    name,
    async ask(prompt: string): Promise<AIResponse> {
      const completion = await c.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 500,
      });
      const content = completion.choices[0]?.message?.content?.trim() ?? "";
      const parsed = parseStructuredResponse(content);
      return { ...parsed, raw: content };
    },
    async *askStream(prompt: string): AsyncGenerator<string, AIResponse> {
      const stream = await c.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 500,
        stream: true,
      });
      let full = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string") {
          full += delta;
          yield delta;
        }
      }
      const parsed = parseStructuredResponse(full.trim());
      return { ...parsed, raw: full.trim() };
    },
  };
}

/** All OpenAI-based models; add more here to show in the UI */
const OPENAI_MODELS = [
  { id: "openai-gpt-4o-mini", name: "GPT-4o Mini", model: "gpt-4o-mini" },
  { id: "openai-gpt-4o", name: "GPT-4o", model: "gpt-4o" },
] as const;

type ModelConfig = (typeof OPENAI_MODELS)[number];
const modelById = new Map<string, ModelConfig>();
const modelByApiName = new Map<string, ModelConfig>();
for (const m of OPENAI_MODELS) {
  modelById.set(m.id, m);
  modelByApiName.set(m.model, m);
}

/** Built on first use so getClient() has run (key loaded). */
function buildOpenAIProviders(): AIProvider[] {
  return OPENAI_MODELS.map((m) => createOpenAIProvider(m.id, m.name, m.model)).filter(
    (p): p is AIProvider => p != null
  );
}
export const openAIProviders: AIProvider[] = buildOpenAIProviders();

/** Create a provider by id on demand. Resolves by exact id, API model name, or "gpt-4o" / "gpt-4o-mini" in the string. */
export function getOpenAIProviderById(id: string): AIProvider | null {
  const trimmed = (id ?? "").trim().toLowerCase();
  let config = modelById.get(trimmed) ?? modelByApiName.get(trimmed);
  if (!config) {
    if (trimmed.includes("gpt-4o-mini") || (trimmed.includes("mini") && trimmed.includes("gpt-4o"))) {
      config = OPENAI_MODELS[0];
    } else if (trimmed.includes("gpt-4o")) {
      config = OPENAI_MODELS[1];
    }
  }
  return config ? createOpenAIProvider(config.id, config.name, config.model) : null;
}

export const openAIProvider = openAIProviders[0] ?? null;
export const openAIProvider4o = openAIProviders[1] ?? null;
