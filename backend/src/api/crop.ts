import { Router } from "express";
import { fetchCornPrices, fetchLatestCornPrice } from "../sources/corn.js";
import { runCropTest, runCropTestVs } from "../domains/crop/service.js";
import { getCropAutoPlayStatus } from "../jobs/autoPlayCrop.js";
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
  if (r?.historyA?.length || r?.historyB?.length) {
    const price = await fetchLatestCornPrice();
    if (price != null && price > 0) {
      const lastA = r.historyA[r.historyA.length - 1];
      const lastB = r.historyB[r.historyB.length - 1];
      status.currentPricePerBushel = price;
      status.liveValueCentsA = lastA ? Math.round(lastA.cashCents + lastA.bushels * price * 100) : r.finalValueCentsA;
      status.liveValueCentsB = lastB ? Math.round(lastB.cashCents + lastB.bushels * price * 100) : r.finalValueCentsB;
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
