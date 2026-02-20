import { Router } from "express";
import { config } from "../config.js";
import { fetchCornPrices, fetchLatestCornPrice } from "../sources/corn.js";
import { runCropTest, runCropTestVs } from "../domains/crop/service.js";
import { getCropAutoPlayStatus } from "../jobs/autoPlayCrop.js";

type TradeRecompute = { costBasis: number; realizedPnlCents: number; buyCount: number; sellCount: number };

/** Recompute cost basis and realized P/L from trade history when HCS/stored value is 0. */
function recomputeFromHistory(history: { pricePerBushel: number; trade?: string; size?: number }[]): TradeRecompute {
  let costBasis = 0;
  let bushels = 0;
  let cash = config.cropBankrollCents;
  let realizedPnlCents = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const s of history) {
    const priceCents = Math.round(s.pricePerBushel * 100);
    if (s.trade === "buy" && (s.size ?? 0) > 0) {
      const spendCents = Math.min(cash, Math.round((s.size as number) * 100));
      const buyBushels = priceCents > 0 ? Math.floor(spendCents / priceCents) : 0;
      if (buyBushels > 0) {
        costBasis += buyBushels * s.pricePerBushel * 100;
        cash -= buyBushels * priceCents;
        bushels += buyBushels;
        buyCount++;
      }
    } else if (s.trade === "sell" && (s.size ?? 0) > 0) {
      const sellBushels = Math.min(bushels, Math.floor(s.size as number));
      if (bushels > 0 && sellBushels > 0) {
        const costBasisOfSold = (costBasis * sellBushels) / bushels;
        const proceedsCents = sellBushels * s.pricePerBushel * 100;
        realizedPnlCents += proceedsCents - costBasisOfSold;
        costBasis = (costBasis * (bushels - sellBushels)) / bushels;
        cash += proceedsCents;
        bushels -= sellBushels;
        sellCount++;
      }
    }
  }
  return { costBasis, realizedPnlCents, buyCount, sellCount };
}
import {
  placeCropNextTestBet,
  listCropNextTestBets,
  placeCropLongTermBet,
  listCropLongTermBets,
  getCropNextTestOddsHistory,
  getCropLongTermOddsHistory,
} from "../domains/crop/market.js";
import { getAIProvider } from "../ai/index.js";
import { deduct as deductUserBalance, credit as creditUserBalance } from "../user-balance.js";

export const cropRouter = Router();

const CROP_MODELS = [
  { id: "openai-gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "openai-gpt-4o", name: "GPT-4o" },
];

cropRouter.get("/models", (_req, res) => {
  res.json({ models: CROP_MODELS });
});

/** GET /api/crop/auto-play-status — next run time, last result, models. Includes live portfolio value at current corn price. */
cropRouter.get("/auto-play-status", async (_req, res) => {
  const status = getCropAutoPlayStatus();
  const r = status.lastResult;
  const startCents = r?.startValueCents ?? config.cropBankrollCents;
  if (r?.historyA?.length || r?.historyB?.length) {
    const recA = recomputeFromHistory(r.historyA);
    const recB = recomputeFromHistory(r.historyB);
    (status as Record<string, unknown>).tradeSummaryA = { buyCount: recA.buyCount, sellCount: recA.sellCount, realizedPnlCents: Math.round(recA.realizedPnlCents) };
    (status as Record<string, unknown>).tradeSummaryB = { buyCount: recB.buyCount, sellCount: recB.sellCount, realizedPnlCents: Math.round(recB.realizedPnlCents) };

    const price = await fetchLatestCornPrice();
    if (price != null && price > 0) {
      const lastA = r.historyA[r.historyA.length - 1];
      const lastB = r.historyB[r.historyB.length - 1];
      status.currentPricePerBushel = price;
      const priceCentsExact = price * 100;
      status.liveValueCentsA = lastA ? Math.round(lastA.cashCents + lastA.bushels * priceCentsExact) : r.finalValueCentsA;
      status.liveValueCentsB = lastB ? Math.round(lastB.cashCents + lastB.bushels * priceCentsExact) : r.finalValueCentsB;

      // Total P/L = live value - start (always correct; includes realized + unrealized)
      status.pnlCentsA = Math.round((status.liveValueCentsA ?? r.finalValueCentsA) - startCents);
      status.pnlCentsB = Math.round((status.liveValueCentsB ?? r.finalValueCentsB) - startCents);

      if (lastA && lastA.bushels > 0) {
        const costBasisA = recA.costBasis > 0 ? recA.costBasis : (typeof lastA.costBasisCents === "number" && lastA.costBasisCents > 0 ? lastA.costBasisCents : 0);
        if (costBasisA > 0) status.avgCostCentsPerBushelA = costBasisA / lastA.bushels;
      }
      if (lastB && lastB.bushels > 0) {
        const costBasisB = recB.costBasis > 0 ? recB.costBasis : (typeof lastB.costBasisCents === "number" && lastB.costBasisCents > 0 ? lastB.costBasisCents : 0);
        if (costBasisB > 0) status.avgCostCentsPerBushelB = costBasisB / lastB.bushels;
      }

    } else {
      status.pnlCentsA = Math.round((r.historyA[r.historyA.length - 1]?.valueCents ?? r.finalValueCentsA) - startCents);
      status.pnlCentsB = Math.round((r.historyB[r.historyB.length - 1]?.valueCents ?? r.finalValueCentsB) - startCents);
    }
  }
  res.json(status);
});

/** GET /api/crop/corn-prices — last ~30 days of US corn futures (for charts or display). */
cropRouter.get("/corn-prices", async (_req, res) => {
  try {
    const prices = await fetchCornPrices();
    res.json({ prices });
  } catch (e) {
    console.error("GET /crop/corn-prices:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch corn prices" });
  }
});

/** POST /api/crop/run-test — body { modelId }. Runs ~30s test with real corn data, returns portfolio history. */
cropRouter.post("/run-test", async (req, res) => {
  try {
    const modelId = String(req.body?.modelId ?? "").trim();
    if (!modelId) return res.status(400).json({ error: "modelId required" });
    const provider = getAIProvider(modelId);
    if (!provider) return res.status(400).json({ error: `Unknown model: ${modelId}` });

    const result = await runCropTest(modelId);
    res.json(result);
  } catch (e) {
    console.error("POST /crop/run-test:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Run test failed" });
  }
});

/** POST /api/crop/run-test-vs — body { modelIdA, modelIdB }. Both models run on same prices; returns both histories. Settles next-test bets. */
cropRouter.post("/run-test-vs", async (req, res) => {
  try {
    const modelIdA = String(req.body?.modelIdA ?? "").trim();
    const modelIdB = String(req.body?.modelIdB ?? "").trim();
    if (!modelIdA || !modelIdB) return res.status(400).json({ error: "modelIdA and modelIdB required" });
    if (modelIdA === modelIdB) return res.status(400).json({ error: "Choose two different models" });
    const providerA = getAIProvider(modelIdA);
    const providerB = getAIProvider(modelIdB);
    if (!providerA) return res.status(400).json({ error: `Unknown model: ${modelIdA}` });
    if (!providerB) return res.status(400).json({ error: `Unknown model: ${modelIdB}` });

    const result = await runCropTestVs(modelIdA, modelIdB);
    res.json(result);
  } catch (e) {
    console.error("POST /crop/run-test-vs:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Run test failed" });
  }
});

/** GET /api/crop/odds-history-next-test — A wins % over time for next-test market. Query: modelAId, modelBId. */
cropRouter.get("/odds-history-next-test", (req, res) => {
  try {
    const modelAId = String(req.query.modelAId ?? "").trim();
    const modelBId = String(req.query.modelBId ?? "").trim();
    if (!modelAId || !modelBId) return res.status(400).json({ error: "modelAId and modelBId required" });
    const series = getCropNextTestOddsHistory(modelAId, modelBId);
    res.json({ modelAId, modelBId, series });
  } catch (e) {
    console.error("GET /crop/odds-history-next-test:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** GET /api/crop/odds-history-longterm — Yes % over time for long-term market. Query: modelId, period. */
cropRouter.get("/odds-history-longterm", (req, res) => {
  try {
    const modelId = String(req.query.modelId ?? "").trim();
    const period = String(req.query.period ?? new Date().getFullYear().toString()).trim();
    if (!modelId) return res.status(400).json({ error: "modelId required" });
    const series = getCropLongTermOddsHistory(modelId, period);
    res.json({ modelId, period, series });
  } catch (e) {
    console.error("GET /crop/odds-history-longterm:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** GET /api/crop/bets — list next-test and long-term crop bets. */
cropRouter.get("/bets", (_req, res) => {
  try {
    res.json({
      nextTestBets: listCropNextTestBets(),
      longTermBets: listCropLongTermBets(),
    });
  } catch (e) {
    console.error("GET /crop/bets:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** POST /api/crop/bet-next-test — body { modelIdA, modelIdB, direction: "a_wins"|"b_wins", amountCents }. Who will be more profitable on the next run test. */
cropRouter.post("/bet-next-test", (req, res) => {
  try {
    const modelIdA = String(req.body?.modelIdA ?? "").trim();
    const modelIdB = String(req.body?.modelIdB ?? "").trim();
    const direction = req.body?.direction === "b_wins" ? "b_wins" : "a_wins";
    const amountCents = Math.round(Number(req.body?.amountCents ?? 0));
    if (!modelIdA || !modelIdB) return res.status(400).json({ error: "modelIdA and modelIdB required" });
    if (modelIdA === modelIdB) return res.status(400).json({ error: "Choose two different models" });
    if (amountCents <= 0) return res.status(400).json({ error: "Positive amountCents required" });
    if (!deductUserBalance(amountCents)) return res.status(400).json({ error: "Insufficient balance" });
    try {
      const bet = placeCropNextTestBet(modelIdA, modelIdB, direction, amountCents);
      res.status(201).json(bet);
    } catch (e) {
      creditUserBalance(amountCents);
      throw e;
    }
  } catch (e) {
    console.error("POST /crop/bet-next-test:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Bet failed" });
  }
});

/** POST /api/crop/bet-longterm — body { modelId, period, predictionBuPerAcre?, direction: "yes"|"no", amountCents }. Bet on whether the model's long-term prediction will be right. */
cropRouter.post("/bet-longterm", (req, res) => {
  try {
    const modelId = String(req.body?.modelId ?? "").trim();
    const period = String(req.body?.period ?? new Date().getFullYear().toString()).trim();
    const predictionBuPerAcre = req.body?.predictionBuPerAcre != null ? Number(req.body.predictionBuPerAcre) : null;
    const direction = req.body?.direction === "no" ? "no" : "yes";
    const amountCents = Math.round(Number(req.body?.amountCents ?? 0));
    if (!modelId) return res.status(400).json({ error: "modelId required" });
    if (amountCents <= 0) return res.status(400).json({ error: "Positive amountCents required" });
    if (!deductUserBalance(amountCents)) return res.status(400).json({ error: "Insufficient balance" });
    try {
      const bet = placeCropLongTermBet(modelId, period, predictionBuPerAcre, direction, amountCents);
      res.status(201).json(bet);
    } catch (e) {
      creditUserBalance(amountCents);
      throw e;
    }
  } catch (e) {
    console.error("POST /crop/bet-longterm:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Bet failed" });
  }
});
