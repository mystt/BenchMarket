/**
 * Fetch blackjack hand history from HCS for display.
 * Used by GET /api/blackjack/hand-history to show persisted hand-by-hand data.
 */

import { fetchTopicMessages } from "./mirror.js";
import { config } from "../config.js";

export type BlackjackHandEntry = {
  handIndex: number;
  totalHands: number;
  betCents: number | null;
  playerCards: string[];
  dealerUpcard: string | null;
  decision: string | null;
  outcome: string | null;
  pnlCents: number | null;
};

/** Fetch blackjack hands from HCS for a given model and date. Returns in display order. */
export async function fetchBlackjackHandHistory(
  modelId: string,
  date: string
): Promise<BlackjackHandEntry[]> {
  if (!config.hederaTopicId) return [];
  const messages = await fetchTopicMessages({ order: "asc", maxMessages: 1000 });
  const hands: BlackjackHandEntry[] = [];
  const dateSlice = String(date).slice(0, 10);

  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const domain = parsed.domain as string | undefined;

      if (domain === "blackjack") {
        const mid = String(parsed.modelId ?? "");
        const d = String(parsed.date ?? "").slice(0, 10);
        if (mid === modelId && d === dateSlice) {
          const playerCards = Array.isArray(parsed.playerCards)
            ? (parsed.playerCards as string[])
            : [];
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0, // filled below
            betCents: typeof parsed.betCents === "number" ? parsed.betCents : null,
            playerCards,
            dealerUpcard: typeof parsed.dealerUpcard === "string" ? parsed.dealerUpcard : null,
            decision: typeof parsed.decision === "string" ? parsed.decision : null,
            outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
            pnlCents: typeof parsed.pnlCents === "number" ? parsed.pnlCents : null,
          });
        }
      } else if (domain === "blackjack_vs") {
        const modelAId = String(parsed.modelIdA ?? "");
        const modelBId = String(parsed.modelBId ?? "");
        const d = String(parsed.date ?? "").slice(0, 10);
        if (d !== dateSlice) continue;
        const pnlA = typeof parsed.pnlA === "number" ? parsed.pnlA : 0;
        const pnlB = typeof parsed.pnlB === "number" ? parsed.pnlB : 0;
        const outcomeA = String(parsed.outcomeA ?? "");
        const outcomeB = String(parsed.outcomeB ?? "");
        if (modelAId === modelId) {
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0,
            betCents: null,
            playerCards: [],
            dealerUpcard: null,
            decision: null,
            outcome: outcomeA || null,
            pnlCents: pnlA,
          });
        }
        if (modelBId === modelId) {
          hands.push({
            handIndex: hands.length + 1,
            totalHands: 0,
            betCents: null,
            playerCards: [],
            dealerUpcard: null,
            decision: null,
            outcome: outcomeB || null,
            pnlCents: pnlB,
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  const total = hands.length;
  hands.forEach((h) => {
    h.totalHands = total;
  });
  return hands;
}
