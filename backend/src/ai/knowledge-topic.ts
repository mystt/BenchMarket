/**
 * AI provider backed by Hedera Knowledge Topic — acts like an LLM over HCS.
 * Sends prompts to KNOWLEDGE_INBOUND_TOPIC_ID; responses arrive via HEDERA_INBOUND_TOPIC_ID.
 */

import { config } from "../config.js";
import { askKnowledge } from "../hedera/knowledge-agent.js";
import type { AIProvider, AIResponse, AIAskContext } from "./types.js";

function parseStructuredResponse(content: string): AIResponse {
  const decisionMatch = content.match(/DECISION:\s*(\w+)/i) ?? content.match(/(?:^|\n)\s*(hit|stand)\s*(?:\n|$)/i);
  const reasoningMatch = content.match(/REASONING:\s*([\s\S]+?)(?=\n\n|$)/i);
  const decision = (decisionMatch?.[1] ?? content.split(/\s+/)[0] ?? "stand").toLowerCase();
  const reasoning = reasoningMatch?.[1]?.trim();
  return {
    decision: decision.startsWith("hit") ? "hit" : "stand",
    reasoning,
    raw: content,
  };
}

function createKnowledgeProvider(): AIProvider | null {
  if (!config.knowledgeInboundTopicId || !config.hederaInboundTopicId) return null;

  return {
    id: "hedera-knowledge",
    name: "Hedera Knowledge",
    async ask(prompt: string, context?: AIAskContext): Promise<AIResponse> {
      const meta =
        context?.handId != null && context?.step != null
          ? {
              type: "blackjack_decision" as const,
              handId: context.handId,
              step: context.step,
              playerCards: context.playerCards ?? [],
              dealerUpcard: context.dealerUpcard ?? "",
              betCents: context.betCents,
            }
          : undefined;
      const content = await askKnowledge(prompt, meta);
      return parseStructuredResponse(content);
    },
  };
}

let provider: AIProvider | null = null;

export function getKnowledgeProvider(): AIProvider | null {
  if (provider === null) {
    provider = createKnowledgeProvider();
  }
  return provider;
}
