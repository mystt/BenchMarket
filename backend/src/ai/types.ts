/**
 * AI integration: we only ask. No data provided from our side beyond
 * the minimal prompt (e.g. game state, match id, contract question).
 */

export type AIModelId = string;

export interface AIResponse {
  decision: string;
  reasoning?: string;
  /** Raw message content when parsing needs full text (e.g. BET: N). */
  raw?: string;
}

/** Optional context for HCS/knowledge providers (multi-message blackjack hands). */
export type AIAskContext = {
  handId?: string;
  step?: number;
  playerCards?: string[];
  dealerUpcard?: string;
  betCents?: number;
};

export interface AIProvider {
  id: AIModelId;
  name: string;
  ask(prompt: string, context?: AIAskContext): Promise<AIResponse>;
  /** Stream content chunks (e.g. reasoning) as they arrive. Caller parses final DECISION when done. */
  askStream?(prompt: string, context?: AIAskContext): AsyncGenerator<string, AIResponse>;
}
