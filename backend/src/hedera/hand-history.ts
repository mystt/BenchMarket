/**
 * Blackjack hand history — serves from in-memory store, falls back to HCS when empty.
 * Newer HCS messages include playerCards, dealerUpcard, bets; older messages may lack them (show what we can).
 */

import { fetchTopicMessages } from "./mirror.js";
import { config } from "../config.js";
import {
  getBlackjackHands,
  loadBlackjackHandHistoryFromHcs,
  type BlackjackHandEntry,
} from "./blackjack-hand-store.js";

export type { BlackjackHandEntry } from "./blackjack-hand-store.js";

/** Resolve value supporting both camelCase and snake_case (format compatibility). */
function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Fetch blackjack hands. Serves from in-memory store first; falls back to HCS when empty. Older HCS messages may lack cards/bets — we show what we have. */
export async function fetchBlackjackHandHistory(
  modelId: string,
  date: string
): Promise<BlackjackHandEntry[]> {
  const dateFilter = date === "all" || !date ? null : String(date).slice(0, 10);
  let hands = getBlackjackHands(modelId, dateFilter);
  if (hands.length > 0) return hands;
  if (!config.hederaTopicId) return [];
  const byModel = await parseAllMessagesToHandsByModel(dateFilter);
  if (byModel.size > 0) {
    loadBlackjackHandHistoryFromHcs(byModel);
  }
  return getBlackjackHands(modelId, dateFilter);
}

/** Parse HCS messages into hands by model. Newer messages have playerCards, dealerUpcard, bets; older ones have outcome/pnl only. */
export async function parseAllMessagesToHandsByModel(
  dateFilter: string | null,
  preFetched?: { consensus_timestamp: string; sequence_number: number; message: string }[]
): Promise<Map<string, BlackjackHandEntry[]>> {
  const messages = preFetched ?? (await fetchTopicMessages({ order: "asc", maxMessages: 10000 }));
  const byModel = new Map<string, BlackjackHandEntry[]>();

  const push = (modelId: string, entry: Omit<BlackjackHandEntry, "handIndex" | "totalHands">) => {
    const list = byModel.get(modelId) ?? [];
    list.push({
      ...entry,
      handIndex: list.length + 1,
      totalHands: 0,
    });
    byModel.set(modelId, list);
  };

  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const domain = (get(parsed, "domain") as string) ?? (parsed.domain as string);
      if (!domain) continue;

      if (domain === "blackjack") {
        const mid = String(get(parsed, "modelId", "model_id") ?? "").trim();
        const d = String(get(parsed, "date") ?? "").slice(0, 10);
        if (!mid) continue;
        if (dateFilter != null && d !== dateFilter) continue;
        const rawCards = get(parsed, "playerCards", "player_cards");
        const playerCards = Array.isArray(rawCards) ? (rawCards as string[]) : [];
        push(mid, {
          date: d || undefined,
          betCents: typeof get(parsed, "betCents", "bet_cents") === "number" ? (get(parsed, "betCents", "bet_cents") as number) : null,
          playerCards,
          dealerUpcard: typeof get(parsed, "dealerUpcard", "dealer_upcard") === "string" ? (get(parsed, "dealerUpcard", "dealer_upcard") as string) : null,
          decision: typeof get(parsed, "decision") === "string" ? (get(parsed, "decision") as string) : null,
          outcome: typeof get(parsed, "outcome") === "string" ? (get(parsed, "outcome") as string) : null,
          pnlCents: typeof get(parsed, "pnlCents", "pnl_cents") === "number" ? (get(parsed, "pnlCents", "pnl_cents") as number) : null,
        });
      } else if (domain === "blackjack_vs") {
        const modelAId = String(get(parsed, "modelIdA", "modelAId", "model_id_a") ?? "").trim();
        const modelBId = String(get(parsed, "modelIdB", "modelBId", "model_b_id") ?? "").trim();
        const d = String(get(parsed, "date") ?? "").slice(0, 10);
        if (dateFilter != null && d !== dateFilter) continue;
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
        if (modelAId) {
          push(modelAId, {
            date: d || undefined,
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
        if (modelBId) {
          push(modelBId, {
            date: d || undefined,
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

  for (const list of byModel.values()) {
    const total = list.length;
    list.forEach((h) => {
      h.totalHands = total;
    });
  }
  return byModel;
}
