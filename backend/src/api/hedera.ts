/**
 * API for Hedera HCS: sync/hydrate from mirror node.
 * GET /api/hedera/sync — re-fetch topic messages and rebuild in-memory state (blackjack, crop).
 * GET /api/hedera/topic-stats — raw message counts by domain (debug).
 * POST /api/hedera/send-to-knowledge — submit a message to KNOWLEDGE_INBOUND_TOPIC_ID (no reply needed).
 */

import { Router } from "express";
import { hydrateFromHedera } from "../hedera/hydrate.js";
import { fetchTopicMessages } from "../hedera/mirror.js";
import { submitToKnowledgeTopic } from "../hedera/knowledge-agent.js";
import { config } from "../config.js";

export const hederaRouter = Router();

/** POST /api/hedera/send-to-knowledge — submit "hello world" to KNOWLEDGE_INBOUND_TOPIC_ID. Uses exact same HCS path as blackjack storage. */
hederaRouter.post("/send-to-knowledge", async (req, res) => {
  const topicId = config.knowledgeInboundTopicId;
  if (!topicId) {
    return res.status(400).json({ error: "Set KNOWLEDGE_INBOUND_TOPIC_ID" });
  }
  try {
    const txId = await submitToKnowledgeTopic("hello world");
    const network = (config.hederaNetwork ?? "testnet") as string;
    const hashscanBase = network === "mainnet" ? "https://hashscan.io" : "https://hashscan.io/testnet";
    res.json({
      ok: true,
      topicId,
      txId,
      hashscanTx: `${hashscanBase}/transaction/${txId}`,
      hashscanTopic: `${hashscanBase}/topic/${topicId}`,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("POST /api/hedera/send-to-knowledge:", e);
    res.status(500).json({ error: errMsg });
  }
});

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

/** GET /api/hedera/bj-hand-store — blackjack hand counts per model (in-memory store, for debugging). */
hederaRouter.get("/bj-hand-store", async (_req, res) => {
  try {
    const { getBlackjackHandModelIds, getBlackjackHands } = await import("../hedera/blackjack-hand-store.js");
    const modelIds = getBlackjackHandModelIds();
    const byModel: Record<string, number> = {};
    for (const id of modelIds) {
      byModel[id] = getBlackjackHands(id, null).length;
    }
    res.json({ byModel, totalHands: Object.values(byModel).reduce((a, b) => a + b, 0) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("GET /api/hedera/bj-hand-store:", e);
    res.status(500).json({ error: msg });
  }
});

/** GET /api/hedera/topic-stats — message counts by domain for debugging persistence. */
hederaRouter.get("/topic-stats", async (_req, res) => {
  if (!config.hederaTopicId) {
    return res.status(400).json({ error: "HEDERA_TOPIC_ID not configured" });
  }
  try {
    const messages = await fetchTopicMessages({ order: "asc", maxMessages: 5000 });
    const counts: Record<string, number> = {};
    let parseErrors = 0;
    for (const { message } of messages) {
      try {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        const domain = String(parsed.domain ?? "unknown");
        counts[domain] = (counts[domain] ?? 0) + 1;
      } catch {
        parseErrors++;
      }
    }
    res.json({
      totalMessages: messages.length,
      parseErrors,
      byDomain: counts,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("GET /api/hedera/topic-stats:", e);
    res.status(500).json({ error: msg });
  }
});
