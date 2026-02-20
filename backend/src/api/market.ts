import { Router } from "express";
import {
  placePerformanceBet,
  listPerformanceBets,
  placeNext3Bet,
  listNext3Bets,
  getLeaderboard,
  getLeaderboardHistory,
  getOddsHistory,
  getNext3OddsHistory,
  settleBetsForPeriod,
} from "../domains/market/service.js";
import { deduct as deductUserBalance, credit as creditUserBalance } from "../user-balance.js";

export const marketRouter = Router();

/** Place a bet on AI performance. Body: { domain, modelId, period (YYYY-MM-DD), direction: "outperform"|"underperform", amountCents } */
marketRouter.post("/bet", async (req, res) => {
  try {
    const domain = String(req.body?.domain ?? "").trim();
    const modelId = String(req.body?.modelId ?? "").trim();
    const period = String(req.body?.period ?? "").trim();
    const direction = req.body?.direction === "underperform" ? "underperform" : "outperform";
    const amountCents = Math.round(Number(req.body?.amountCents ?? 0));
    if (!domain || !modelId || !period || amountCents <= 0) {
      return res.status(400).json({ error: "domain, modelId, period (YYYY-MM-DD), and positive amountCents required" });
    }
    if (!deductUserBalance(amountCents)) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    try {
      const bet = await placePerformanceBet(domain, modelId, period, direction, amountCents);
      res.status(201).json(bet);
    } catch (e) {
      creditUserBalance(amountCents);
      throw e;
    }
  } catch (e) {
    console.error("POST /market/bet error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** List all performance bets and next-3-hands bets (next3 are settled when listed). */
marketRouter.get("/bets", async (_req, res) => {
  try {
    const bets = await listPerformanceBets();
    const next3Bets = await listNext3Bets();
    res.json({ bets, next3Bets });
  } catch (e) {
    console.error("GET /market/bets error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Place a next-3-hands bet: who will profit more over the next 3 hands. Body: { modelAId, modelBId, direction: "a_wins"|"b_wins", amountCents } */
marketRouter.post("/bet-next3", async (req, res) => {
  try {
    const modelAId = String(req.body?.modelAId ?? "").trim();
    const modelBId = String(req.body?.modelBId ?? "").trim();
    const direction = req.body?.direction === "b_wins" ? "b_wins" : "a_wins";
    const amountCents = Math.round(Number(req.body?.amountCents ?? 0));
    if (!modelAId || !modelBId || amountCents <= 0) {
      return res.status(400).json({ error: "modelAId, modelBId, and positive amountCents required" });
    }
    if (!deductUserBalance(amountCents)) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    try {
      const bet = await placeNext3Bet(modelAId, modelBId, direction, amountCents);
      res.status(201).json(bet);
    } catch (e) {
      creditUserBalance(amountCents);
      throw e;
    }
  } catch (e) {
    console.error("POST /market/bet-next3 error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Leaderboard: daily P/L per model. Query: domain=blackjack&period=YYYY-MM-DD. Settles pending bets only when period is in the past (day is over). */
marketRouter.get("/leaderboard", async (req, res) => {
  try {
    const domain = String(req.query.domain ?? "blackjack");
    const period = String(req.query.period ?? new Date().toISOString().slice(0, 10));
    const today = new Date().toISOString().slice(0, 10);
    if (period < today) await settleBetsForPeriod(domain, period);
    const leaderboard = await getLeaderboard(domain, period);
    res.json({ domain, period, leaderboard });
  } catch (e) {
    console.error("GET /market/leaderboard error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Leaderboard history: cumulative P/L per hand for chart. Query: domain=blackjack&period=YYYY-MM-DD. */
marketRouter.get("/leaderboard-history", async (req, res) => {
  try {
    const domain = String(req.query.domain ?? "blackjack");
    const period = String(req.query.period ?? new Date().toISOString().slice(0, 10));
    const series = await getLeaderboardHistory(domain, period);
    res.json({ domain, period, series });
  } catch (e) {
    console.error("GET /market/leaderboard-history error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Odds history: implied Yes % over time for prediction market chart. Query: domain=blackjack&modelId=...&period=YYYY-MM-DD. */
marketRouter.get("/odds-history", async (req, res) => {
  try {
    const domain = String(req.query.domain ?? "blackjack");
    const modelId = String(req.query.modelId ?? "").trim();
    const period = String(req.query.period ?? new Date().toISOString().slice(0, 10));
    if (!modelId) return res.status(400).json({ error: "modelId required" });
    const series = await getOddsHistory(domain, modelId, period);
    res.json({ domain, modelId, period, series });
  } catch (e) {
    console.error("GET /market/odds-history error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

/** Odds history for Next 3 hands market (A wins % over time). Query: modelAId=...&modelBId=...&period=YYYY-MM-DD. */
marketRouter.get("/odds-history-next3", async (req, res) => {
  try {
    const modelAId = String(req.query.modelAId ?? "").trim();
    const modelBId = String(req.query.modelBId ?? "").trim();
    const period = String(req.query.period ?? new Date().toISOString().slice(0, 10));
    if (!modelAId || !modelBId) return res.status(400).json({ error: "modelAId and modelBId required" });
    const series = await getNext3OddsHistory(modelAId, modelBId, period);
    res.json({ modelAId, modelBId, period, series });
  } catch (e) {
    console.error("GET /market/odds-history-next3 error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});
