/**
 * Hydrate in-memory stores from Hedera HCS topic messages (mirror node).
 * Run on startup when HEDERA_TOPIC_ID is set. Parses messages and rebuilds state.
 */

import { config } from "../config.js";
import { fetchTopicMessages } from "./mirror.js";
import { loadBlackjackHandsFromHedera, recomputeDailyBankrollsFromHands } from "../db/memory-db.js";
import { setCropVsStateFromHydration } from "../jobs/autoPlayCrop.js";
import { parseAllMessagesToHandsByModel } from "./hand-history.js";
import { loadBlackjackHandHistoryFromHcs } from "./blackjack-hand-store.js";
import type { CropVsState, CropPortfolioSnapshot } from "../domains/crop/service.js";

export async function hydrateFromHedera(): Promise<void> {
  if (!config.hederaTopicId) return;
  const messages = await fetchTopicMessages({ order: "asc", maxMessages: 10000 });
  if (messages.length === 0) return;
  console.log(`[HCS Hydrate] Fetched ${messages.length} messages from topic`);

  let blackjackCount = 0;
  let blackjackVsCount = 0;
  let cropDecisionCount = 0;
  let cropSkipped = 0;
  const blackjackHands: Array<{ model_id: string; date: string; pnl_cents: number }> = [];
  let cropState: CropVsState | null = null;
  let cropModelAId = "";
  let cropModelBId = "";

  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const domain = parsed.domain as string | undefined;

      if (domain === "blackjack") {
        blackjackCount++;
        const modelId = String(parsed.modelId ?? "");
        const date = String(parsed.date ?? "").slice(0, 10);
        const pnlCents = Number(parsed.pnlCents ?? 0);
        if (modelId && date) blackjackHands.push({ model_id: modelId, date, pnl_cents: pnlCents });
      } else if (domain === "blackjack_vs") {
        blackjackVsCount++;
        const modelAId = String(parsed.modelIdA ?? "");
        const modelBId = String(parsed.modelIdB ?? "");
        const date = String(parsed.date ?? "").slice(0, 10);
        const pnlA = Number(parsed.pnlA ?? 0);
        const pnlB = Number(parsed.pnlB ?? 0);
        if (modelAId && date) blackjackHands.push({ model_id: modelAId, date, pnl_cents: pnlA });
        if (modelBId && date) blackjackHands.push({ model_id: modelBId, date, pnl_cents: pnlB });
      } else if (domain === "crop_decision") {
        cropDecisionCount++;
        const modelAId = String(parsed.modelAId ?? "");
        const modelBId = String(parsed.modelBId ?? "");
        const sa = parsed.snapshotA as Record<string, unknown> | undefined;
        const sb = parsed.snapshotB as Record<string, unknown> | undefined;
        if (!sa || !sb || !modelAId || !modelBId) {
          cropSkipped++;
          continue;
        }

        const snapA = toPortfolioSnapshot(sa);
        const snapB = toPortfolioSnapshot(sb);
        if (!snapA || !snapB) {
          cropSkipped++;
          continue;
        }

        cropModelAId = modelAId;
        cropModelBId = modelBId;
        cropState = {
          cashA: snapA.cashCents,
          bushelsA: snapA.bushels,
          costBasisA: snapA.costBasisCents ?? 0,
          cashB: snapB.cashCents,
          bushelsB: snapB.bushels,
          costBasisB: snapB.costBasisCents ?? 0,
          historyA: cropState ? [...cropState.historyA, snapA] : [snapA],
          historyB: cropState ? [...cropState.historyB, snapB] : [snapB],
        };
      }
    } catch {
      /* skip malformed */
    }
  }

  console.log(
    `[HCS Hydrate] ${messages.length} messages: blackjack=${blackjackCount}, blackjack_vs=${blackjackVsCount}, crop_decision=${cropDecisionCount} (skipped=${cropSkipped})`
  );
  if (blackjackHands.length > 0 && config.useSqlite) {
    loadBlackjackHandsFromHedera(blackjackHands);
    recomputeDailyBankrollsFromHands(config.blackjackDailyCents);
    console.log(`[HCS Hydrate] Loaded ${blackjackHands.length} blackjack hands`);
  }
  const handHistoryByModel = await parseAllMessagesToHandsByModel(null, messages);
  if (handHistoryByModel.size > 0) {
    loadBlackjackHandHistoryFromHcs(handHistoryByModel);
    const total = Array.from(handHistoryByModel.values()).reduce((s, list) => s + list.length, 0);
    const perModel = Array.from(handHistoryByModel.entries()).map(([id, list]) => `${id}:${list.length}`).join(", ");
    console.log(`[HCS Hydrate] Loaded blackjack hand history: ${total} hands for ${handHistoryByModel.size} models (${perModel})`);
  } else if (blackjackCount > 0 || blackjackVsCount > 0) {
    console.warn(`[HCS Hydrate] Blackjack messages found (${blackjackCount}+${blackjackVsCount}) but parseAllMessagesToHandsByModel returned 0 hands - check message format`);
  }
  if (cropState && cropModelAId && cropModelBId) {
    setCropVsStateFromHydration(cropState, { modelAId: cropModelAId, modelBId: cropModelBId });
    console.log(
      `[HCS Hydrate] Loaded crop state: ${cropModelAId} vs ${cropModelBId}, ${cropState.historyA.length} decisions each`
    );
  }
}

function toPortfolioSnapshot(obj: Record<string, unknown>): CropPortfolioSnapshot | null {
  const date = String(obj.date ?? "");
  const pricePerBushel = Number(obj.pricePerBushel ?? 0);
  const cashCents = Number(obj.cashCents ?? 0);
  const bushels = Number(obj.bushels ?? 0);
  const valueCents = Number(obj.valueCents ?? 0);
  if (!date) return null;
  if (pricePerBushel === 0 && bushels === 0 && cashCents === 0) return null;
  const costBasisCents = obj.costBasisCents != null ? Number(obj.costBasisCents) : undefined;
  return {
    date,
    pricePerBushel,
    cashCents,
    bushels,
    valueCents,
    costBasisCents: Number.isFinite(costBasisCents) ? costBasisCents : undefined,
    trade: (obj.trade === "buy" || obj.trade === "sell" || obj.trade === "hold" ? obj.trade : undefined),
    size: obj.size as number | undefined,
    reasoning: (obj.reasoning as string | null | undefined) ?? undefined,
    longTermBushelsPerAcre: (obj.longTermBushelsPerAcre as number | null | undefined) ?? undefined,
    reasonLongTerm: (obj.reasonLongTerm as string | null | undefined) ?? undefined,
  };
}
