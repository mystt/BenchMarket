import type { AIProvider } from "./types.js";
import { getOpenAIProviderById } from "./openai.js";
import { getKnowledgeProvider } from "./knowledge-topic.js";

export type { AIProvider, AIResponse, AIModelId } from "./types.js";

const PROVIDER_IDS = ["openai-gpt-4o-mini", "openai-gpt-4o", "hedera-knowledge"] as const;
const providers: AIProvider[] = [];

export function getAIProviders(): AIProvider[] {
  for (const id of PROVIDER_IDS) {
    if (!providers.some((p) => p.id === id)) {
      const p = id === "hedera-knowledge" ? getKnowledgeProvider() : getOpenAIProviderById(id);
      if (p) providers.push(p);
    }
  }
  return providers;
}

export function getAIProvider(id: string): AIProvider | undefined {
  const key = (id ?? "").trim();
  const keyLower = key.toLowerCase();
  const found = providers.find((p) => p.id.toLowerCase() === keyLower);
  if (found) return found;
  if (keyLower === "hedera-knowledge") {
    const created = getKnowledgeProvider();
    if (created) {
      providers.push(created);
      return created;
    }
  }
  const created = getOpenAIProviderById(key);
  if (created) {
    providers.push(created);
    return created;
  }
  return undefined;
}
