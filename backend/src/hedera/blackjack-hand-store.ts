/**
 * In-memory blackjack hand history store — mirrors the crop pattern.
 * Updated in real-time when hands are played; loaded from HCS during hydrate.
 * Hand-history API serves from this store (like crop auto-play-status serves lastResult).
 */

export type BlackjackHandEntry = {
  handIndex: number;
  totalHands: number;
  date?: string;
  betCents: number | null;
  playerCards: string[];
  dealerUpcard: string | null;
  dealerCards?: string[];
  dealerTotal?: number | null;
  decision: string | null;
  outcome: string | null;
  pnlCents: number | null;
};

/** modelId -> list of hands (chronological) */
const handsByModel = new Map<string, BlackjackHandEntry[]>();

/** Append a hand when played (real-time update, like crop's lastResult). */
export function appendBlackjackHand(modelId: string, entry: Omit<BlackjackHandEntry, "handIndex" | "totalHands">): void {
  const list = handsByModel.get(modelId) ?? [];
  const total = list.length + 1;
  list.push({
    ...entry,
    handIndex: total,
    totalHands: total,
  });
  handsByModel.set(modelId, list);
  // Update totalHands for all entries in this model's list
  list.forEach((h, i) => {
    h.totalHands = total;
  });
}

/** Replace store with data from HCS hydrate (like setCropVsStateFromHydration). */
export function loadBlackjackHandHistoryFromHcs(entriesByModel: Map<string, BlackjackHandEntry[]>): void {
  handsByModel.clear();
  for (const [modelId, entries] of entriesByModel) {
    const list = entries.map((e, i) => ({
      ...e,
      handIndex: i + 1,
      totalHands: entries.length,
    }));
    list.forEach((h) => {
      h.totalHands = list.length;
    });
    handsByModel.set(modelId, list);
  }
}

/** Get hands for a model. dateFilter: YYYY-MM-DD or null for all. */
export function getBlackjackHands(modelId: string, dateFilter: string | null): BlackjackHandEntry[] {
  const list = handsByModel.get(modelId) ?? [];
  if (!dateFilter) return list;
  return list.filter((h) => h.date && h.date.slice(0, 10) === dateFilter);
}

/** Get all model IDs that have hands (for debugging). */
export function getBlackjackHandModelIds(): string[] {
  return Array.from(handsByModel.keys());
}
