import { Router } from "express";
import { getBalance, claimDaily, creditWatchAd } from "../user-balance.js";

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

/** POST /api/user/watch-ad — placeholder: credit $100. */
userRouter.post("/watch-ad", (req, res) => {
  try {
    const balanceCents = creditWatchAd();
    res.json({ balanceCents });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});
