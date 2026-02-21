import { Router } from "express";
import { getBalance, claimDaily, creditWatchAd } from "../user-balance.js";
import { listPerformanceBets } from "../domains/market/service.js";
import { listCropNextTestBets, listCropLongTermBets } from "../domains/crop/market.js";

export const userRouter = Router();

/** GET /api/user/balance */
userRouter.get("/balance", (_req, res) => {
  try {
    const data = getBalance();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** POST /api/user/daily — claim $1000 for today (once per day). */
userRouter.post("/daily", (req, res) => {
  try {
    const balanceCents = claimDaily();
    res.json({ balanceCents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    const status = msg.includes("already claimed") ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

/** GET /api/user/profile — balance, betting stats, and bet history. */
userRouter.get("/profile", async (_req, res) => {
  try {
    const { balanceCents, dailyClaimedToday } = getBalance();
    const performanceBets = await listPerformanceBets();
    const cropNextTestBets = listCropNextTestBets();
    const cropLongTermBets = listCropLongTermBets();

    let totalWageredCents = 0;
    let totalPnlCents = 0;

    for (const b of performanceBets) {
      totalWageredCents += b.amount_cents;
      if (b.outcome !== "pending" && b.payout_cents != null) {
        totalPnlCents += b.payout_cents - b.amount_cents;
      }
    }
    for (const b of cropNextTestBets) {
      totalWageredCents += b.amount_cents;
      if (b.outcome !== "pending" && b.payout_cents != null) {
        totalPnlCents += b.payout_cents - b.amount_cents;
      }
    }
    for (const b of cropLongTermBets) {
      totalWageredCents += b.amount_cents;
      if (b.outcome !== "pending" && b.payout_cents != null) {
        totalPnlCents += b.payout_cents - b.amount_cents;
      }
    }

    res.json({
      balanceCents,
      dailyClaimedToday,
      totalWageredCents,
      totalPnlCents,
      performanceBets,
      cropNextTestBets,
      cropLongTermBets,
    });
  } catch (e) {
    console.error("GET /user/profile error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

/** POST /api/user/watch-ad — placeholder: credit $100. */
userRouter.post("/watch-ad", (req, res) => {
  try {
    const balanceCents = creditWatchAd();
    res.json({ balanceCents });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});
