/**
 * Fetch blackjack hand history from HCS topic for display.
 * Used by GET /api/blackjack/hand-history to show persisted hand-by-hand data.
 * Data must be on the topic; no DB fallback.
 */

import { fetchTopicMessages } from "./mirror.js";
import { config } from "../config.js";

export type BlackjackHandEntry = {
  handIndex: number;
  totalHands: number;
  betCents: number | null;
  playerCards: string[];
  dealerUpcard: string | null;
  dealerCards?: string[];
  dealerTotal?: number | null;
  decision: string | null;
  outcome: string | null;
  pnlCents: number | null;
};

/** Resolve value supporting both camelCase and snake_case (format compatibility). */
function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Fetch blackjack hands from HCS topic for a given model and date. Returns in display order. */
export async function fetchBlackjackHandHistory(
  modelId: string,
  date: string
): Promise<BlackjackHandEntry[]> {
  if (!config.hederaTopicId) return [];
  const dateSlice = String(date).slice(0, 10);
  return fetchFromHcs(modelId, dateSlice);
}

async function fetchFromHcs(modelId: string, dateSlice: string): Promise<BlackjackHandEntry[]> {
  const messages = await fetchTopicMessages({ order: "asc", maxMessages: 5000 });
  const hands: BlackjackHandEntry[] = [];

  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const domain = (get(parsed, "domain") as string) ?? (parsed.domain as string);
      if (!domain) continue;

      if (domain === "blackjack") {
        const mid = String(get(parsed, "modelId", "model_id") ?? "").trim();
        const d = String(get(parsed, "date") ?? "").slice(0, 10);
        if (mid === modelId && d === dateSlice) {
          const rawCards = get(parsed, "playerCards", "player_cards");
          const playerCards = Array.isArray(rawCards) ? (rawCards as string[]) : [];
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0,
            betCents: typeof get(parsed, "betCents", "bet_cents") === "number" ? (get(parsed, "betCents", "bet_cents") as number) : null,
            playerCards,
            dealerUpcard: typeof get(parsed, "dealerUpcard", "dealer_upcard") === "string" ? (get(parsed, "dealerUpcard", "dealer_upcard") as string) : null,
            decision: typeof get(parsed, "decision") === "string" ? (get(parsed, "decision") as string) : null,
            outcome: typeof get(parsed, "outcome") === "string" ? (get(parsed, "outcome") as string) : null,
            pnlCents: typeof get(parsed, "pnlCents", "pnl_cents") === "number" ? (get(parsed, "pnlCents", "pnl_cents") as number) : null,
          });
        }
      } else if (domain === "blackjack_vs") {
        const modelAId = String(get(parsed, "modelIdA", "model_id_a") ?? "").trim();
        const modelBId = String(get(parsed, "modelBId", "model_b_id") ?? "").trim();
        const d = String(get(parsed, "date") ?? "").slice(0, 10);
        if (d !== dateSlice) continue;
        const pnlA = typeof get(parsed, "pnlA", "pnl_a") === "number" ? (get(parsed, "pnlA", "pnl_a") as number) : 0;
        const pnlB = typeof get(parsed, "pnlB", "pnl_b") === "number" ? (get(parsed, "pnlB", "pnl_b") as number) : 0;
        const outcomeA = String(get(parsed, "outcomeA", "outcome_a") ?? "");
        const outcomeB = String(get(parsed, "outcomeB", "outcome_b") ?? "");
        const rawPA = get(parsed, "playerACards", "player_a_cards");
        const rawPB = get(parsed, "playerBCards", "player_b_cards");
        const rawDC = get(parsed, "dealerCards", "dealer_cards");
        const playerACards = Array.isArray(rawPA) ? (rawPA as string[]) : [];
        const playerBCards = Array.isArray(rawPB) ? (rawPB as string[]) : [];
        const dealerCards = Array.isArray(rawDC) ? (rawDC as string[]) : [];
        const dealerUpcard = typeof get(parsed, "dealerUpcard", "dealer_upcard") === "string" ? (get(parsed, "dealerUpcard", "dealer_upcard") as string) : null;
        const dealerTotal = typeof get(parsed, "dealerTotal", "dealer_total") === "number" ? (get(parsed, "dealerTotal", "dealer_total") as number) : null;
        const betA = typeof get(parsed, "betA", "bet_a") === "number" ? (get(parsed, "betA", "bet_a") as number) : null;
        const betB = typeof get(parsed, "betB", "bet_b") === "number" ? (get(parsed, "betB", "bet_b") as number) : null;
        const decisionA = typeof get(parsed, "decisionA", "decision_a") === "string" ? (get(parsed, "decisionA", "decision_a") as string) : null;
        const decisionB = typeof get(parsed, "decisionB", "decision_b") === "string" ? (get(parsed, "decisionB", "decision_b") as string) : null;
        if (modelAId === modelId) {
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0,
            betCents: betA,
            playerCards: playerACards,
            dealerUpcard: dealerUpcard ?? null,
            dealerCards: dealerCards.length > 0 ? dealerCards : undefined,
            dealerTotal: dealerTotal ?? undefined,
            decision: decisionA,
            outcome: outcomeA || null,
            pnlCents: pnlA,
          });
        }
        if (modelBId === modelId) {
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0,
            betCents: betB,
            playerCards: playerBCards,
            dealerUpcard: dealerUpcard ?? null,
            dealerCards: dealerCards.length > 0 ? dealerCards : undefined,
            dealerTotal: dealerTotal ?? undefined,
            decision: decisionB,
            outcome: outcomeB || null,
            pnlCents: pnlB,
          });
        }
      }
    } catch {
      /* skip malformed */
    }
  }

  const total = hands.length;
  hands.forEach((h) => {
    h.totalHands = total;
  });
  return hands;
}
