#!/usr/bin/env npx tsx
/**
 * Fetch crop average cost for a model from HCS topic.
 * Run: npx tsx backend/scripts/fetch-crop-avg-from-hcs.ts [modelId]
 * Default modelId: openai-gpt-4o
 */

import { config } from "../src/config.js";
import { fetchTopicMessages } from "../src/hedera/mirror.js";

const TARGET_MODEL = process.argv[2] ?? "openai-gpt-4o";

/** Recompute cost basis by replaying trades when HCS has 0. */
function recomputeCostBasis(
  snapshots: { pricePerBushel: number; trade?: string; size?: number }[],
  bankrollCents: number
): { costBasis: number; bushels: number } {
  let costBasis = 0;
  let bushels = 0;
  let cash = bankrollCents;
  for (const s of snapshots) {
    const priceCents = Math.round(s.pricePerBushel * 100);
    if (s.trade === "buy" && (s.size ?? 0) > 0) {
      const spendCents = Math.min(cash, Math.round((s.size as number) * 100));
      const buyBushels = priceCents > 0 ? Math.floor(spendCents / priceCents) : 0;
      if (buyBushels > 0) {
        costBasis += buyBushels * s.pricePerBushel * 100; // exact for weighted avg
        cash -= buyBushels * priceCents;
        bushels += buyBushels;
      }
    } else if (s.trade === "sell" && (s.size ?? 0) > 0) {
      const sellBushels = Math.min(bushels, Math.floor(s.size as number));
      if (bushels > 0 && sellBushels > 0) {
        costBasis = (costBasis * (bushels - sellBushels)) / bushels;
        cash += sellBushels * priceCents;
        bushels -= sellBushels;
      }
    }
  }
  return { costBasis, bushels };
}

async function main() {
  if (!config.hederaTopicId) {
    console.error("HEDERA_TOPIC_ID not set in .env");
    process.exit(1);
  }

  console.log(`Fetching crop_decision messages from HCS for model: ${TARGET_MODEL}\n`);

  const messages = await fetchTopicMessages({ order: "asc", maxMessages: 10000 });
  if (messages.length === 0) {
    console.log("No messages found.");
    return;
  }

  type Snapshot = { date: string; pricePerBushel: number; cashCents: number; bushels: number; costBasisCents?: number; trade?: string; size?: number };
  let cropState: { modelAId: string; modelBId: string; historyA: Snapshot[]; historyB: Snapshot[] } | null = null;

  for (const { message } of messages) {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      if (parsed.domain !== "crop_decision") continue;

      const modelAId = String(parsed.modelAId ?? "");
      const modelBId = String(parsed.modelBId ?? "");
      const sa = parsed.snapshotA as Record<string, unknown> | undefined;
      const sb = parsed.snapshotB as Record<string, unknown> | undefined;
      if (!sa || !sb || !modelAId || !modelBId) continue;

      const toSnap = (o: Record<string, unknown>): Snapshot => ({
        date: String(o.date ?? ""),
        pricePerBushel: Number(o.pricePerBushel ?? 0),
        cashCents: Number(o.cashCents ?? 0),
        bushels: Number(o.bushels ?? 0),
        costBasisCents: o.costBasisCents != null && o.costBasisCents !== "" ? Number(o.costBasisCents) : undefined,
        trade: o.trade as string | undefined,
        size: o.size as number | undefined,
      });

      cropState = {
        modelAId,
        modelBId,
        historyA: cropState ? [...cropState.historyA, toSnap(sa)] : [toSnap(sa)],
        historyB: cropState ? [...cropState.historyB, toSnap(sb)] : [toSnap(sb)],
      };
    } catch {
      /* skip */
    }
  }

  if (!cropState) {
    console.log("No crop_decision messages found.");
    return;
  }

  const isModelA = cropState.modelAId === TARGET_MODEL;
  const isModelB = cropState.modelBId === TARGET_MODEL;
  if (!isModelA && !isModelB) {
    console.log(`Model ${TARGET_MODEL} not in crop VS. Current pair: ${cropState.modelAId} vs ${cropState.modelBId}`);
    return;
  }

  const history = isModelA ? cropState.historyA : cropState.historyB;
  const last = history[history.length - 1];
  if (!last || last.bushels === 0) {
    console.log(`${TARGET_MODEL}: No corn position (0 bushels).`);
    return;
  }

  let costBasis = last.costBasisCents;
  if (costBasis == null || !Number.isFinite(costBasis) || costBasis <= 0) {
    // Find most recent snapshot WITH cost basis (older HCS msgs may omit it)
    const withBasis = history.filter((h) => h.costBasisCents != null && h.costBasisCents > 0);
    const fallback = withBasis[withBasis.length - 1];
    if (fallback) {
      const avg = fallback.costBasisCents! / fallback.bushels;
      console.log(`${TARGET_MODEL}: Last snapshot has no cost basis; using most recent with basis (snapshot #${history.indexOf(fallback) + 1}/${history.length})`);
      console.log(`  Bushels: ${fallback.bushels}, Cost basis: ${(fallback.costBasisCents! / 100).toLocaleString()}¢`);
      console.log(`\nAverage cost: ${avg.toFixed(2)}¢/bu`);
      return;
    }
    // Recompute from trade history
    const { costBasis: recomputed, bushels: recomputedBushels } = recomputeCostBasis(history, config.cropBankrollCents);
    if (recomputed <= 0 || recomputedBushels !== last.bushels) {
      console.log(`${TARGET_MODEL}: Could not recompute. Last: ${last.bushels} bushels (recomputed ${recomputedBushels}), cost basis 0 in HCS.`);
      return;
    }
    costBasis = recomputed;
    console.log(`${TARGET_MODEL}: Recomputed cost basis from trade history (HCS had 0).`);
  }

  const avgCostCentsPerBushel = costBasis / last.bushels;
  console.log(`Model: ${TARGET_MODEL}`);
  console.log(`Crop pair: ${cropState.modelAId} vs ${cropState.modelBId}`);
  console.log(`Decisions: ${history.length}`);
  console.log(`Last snapshot: ${last.bushels} bushels, cost basis ${(costBasis / 100).toLocaleString()}¢`);
  console.log(`\nAverage cost: ${avgCostCentsPerBushel.toFixed(2)}¢/bu`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
