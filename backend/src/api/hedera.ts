/**
 * API for Hedera HCS: sync/hydrate from mirror node.
 * GET /api/hedera/sync — re-fetch topic messages and rebuild in-memory state (blackjack, crop).
 * Lets the system pull in data from before for charts without restarting.
 */

import { Router } from "express";
import { hydrateFromHedera } from "../hedera/hydrate.js";
import { config } from "../config.js";

export const hederaRouter = Router();

/** GET /api/hedera/sync — re-hydrate from HCS mirror node. Rebuilds blackjack hands and crop state for charts. */
hederaRouter.get("/sync", async (_req, res) => {
  if (!config.hederaTopicId) {
    return res.status(400).json({ error: "HEDERA_TOPIC_ID not configured" });
  }
  try {
    await hydrateFromHedera();
    res.json({ ok: true, message: "Hydrated from HCS topic" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("GET /api/hedera/sync:", e);
    res.status(500).json({ error: msg });
  }
});
