/**
 * API for Hedera HCS: sync/hydrate from mirror node.
 * GET /api/hedera/sync — re-fetch topic messages and rebuild in-memory state (blackjack, crop).
 * GET /api/hedera/topic-stats — raw message counts by domain (debug).
 * POST /api/hedera/send-to-knowledge — submit a message to KNOWLEDGE_INBOUND_TOPIC_ID (no reply needed).
 */

import { Router } from "express";
import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { hydrateFromHedera } from "../hedera/hydrate.js";
import { fetchTopicMessages } from "../hedera/mirror.js";
import { config } from "../config.js";

function getHederaClient(): Client | null {
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) return null;
  try {
    const net = hederaNetwork ?? "testnet";
    const client =
      net === "mainnet" ? Client.forMainnet() : net === "previewnet" ? Client.forPreviewnet() : Client.forTestnet();
    const keyStr = hederaOperatorKey.replace(/\s/g, "").trim().replace(/^0x/i, "");
    const key =
      /^[0-9a-fA-F]{64}$/.test(keyStr)
        ? (hederaKeyType === "ed25519" ? PrivateKey.fromStringED25519(keyStr) : PrivateKey.fromStringECDSA(keyStr))
        : /^302[ce][0-9a-fA-F]+$/.test(keyStr) || (keyStr.length > 64 && /^[0-9a-fA-F]+$/.test(keyStr))
          ? PrivateKey.fromStringDer(keyStr)
          : PrivateKey.fromString(hederaOperatorKey);
    client.setOperator(hederaOperatorId, key);
    return client;
  } catch {
    return null;
  }
}

export const hederaRouter = Router();

/** Shared handler — submit message to KNOWLEDGE_INBOUND_TOPIC_ID. Exported for use by blackjack router. */
export async function handleSendToKnowledge(req: { body?: unknown }, res: { status: (n: number) => { json: (o: object) => void }; json: (o: object) => void }) {
  const topicId = config.knowledgeInboundTopicId;
  const client = getHederaClient();
  if (!topicId || !client) {
    return res.status(400).json({
      error: "Set KNOWLEDGE_INBOUND_TOPIC_ID, HEDERA_OPERATOR_ID, and HEDERA_OPERATOR_KEY",
    });
  }
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const msg =
      typeof body.message === "string"
        ? body.message
        : JSON.stringify(body.message ?? { test: true, ts: new Date().toISOString() });
    const tx = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(msg);
    await tx.execute(client);
    console.log("[Hedera] Sent message to knowledge topic", topicId);
    res.json({ ok: true, topicId, message: "Message submitted. Check HashScan for topic " + topicId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("POST send-to-knowledge:", e);
    res.status(500).json({ error: msg });
  }
}

hederaRouter.post("/send-to-knowledge", (req, res) => handleSendToKnowledge(req, res));

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
  if (!config.hederaTopicId) {
    return res.status(400).json({ error: "HEDERA_TOPIC_ID not configured" });
  }
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
