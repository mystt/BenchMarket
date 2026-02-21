import { Router } from "express";
import { config } from "../config.js";
import { playHand, getBlackjackDailyState, playHandsStream, playHandsStreamVs, getAIBetCents, type StreamEvent, type StreamEventVs } from "../domains/blackjack/service.js";
import { getAIProviders } from "../ai/index.js";
import { getAutoPlayStatus, claimPendingHand, setAutoPlayLastHandAt } from "../jobs/autoPlayBlackjack.js";
import { fetchBlackjackHandHistory } from "../hedera/hand-history.js";
import { submitToTopic } from "../hedera/hcs.js";

export const blackjackRouter = Router();

/** POST /api/blackjack/send-to-knowledge — submit "hello world" to KNOWLEDGE_INBOUND_TOPIC_ID. Uses exact same HCS path as blackjack storage. */
blackjackRouter.post("/send-to-knowledge", async (req, res) => {
  const topicId = config.knowledgeInboundTopicId;
  if (!topicId) {
    return res.status(400).json({ error: "Set KNOWLEDGE_INBOUND_TOPIC_ID" });
  }
  try {
    const msg = "hello world";
    await submitToTopic(topicId, msg);
    res.json({ ok: true, topicId, message: "Message submitted. Check HashScan for topic " + topicId });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("POST /api/blackjack/send-to-knowledge:", e);
    res.status(500).json({ error: errMsg });
  }
});

/** Always return both models for the dropdown; actual lookup uses getAIProvider(id) when playing */
const MODEL_OPTIONS = [
  { id: "openai-gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "openai-gpt-4o", name: "GPT-4o" },
  { id: "hedera-knowledge", name: "Hedera Knowledge" },
];

blackjackRouter.get("/models", (_req, res) => {
  res.json({ models: MODEL_OPTIONS });
});

blackjackRouter.get("/auto-play-status", (_req, res) => {
  res.json(getAutoPlayStatus());
});

/** GET /api/blackjack/hand-history — persisted hand list from HCS. Query: modelId, date (YYYY-MM-DD, or "all" / omit for all dates). */
blackjackRouter.get("/hand-history", async (req, res) => {
  try {
    const modelId = String(req.query.modelId ?? "").trim();
    const dateParam = String(req.query.date ?? "").trim().toLowerCase();
    const date = dateParam === "all" || dateParam === "" ? "all" : String(dateParam).slice(0, 10);
    if (!modelId) return res.status(400).json({ error: "modelId required" });
    const hands = await fetchBlackjackHandHistory(modelId, date);
    res.json({ modelId, date: date === "all" ? "all" : date, hands });
  } catch (e) {
    console.error("GET /blackjack/hand-history error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

blackjackRouter.get("/daily/:modelId", async (req, res) => {
  try {
    const modelId = req.params.modelId;
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const state = await getBlackjackDailyState(modelId, date);
    res.json(state);
  } catch (e) {
    console.error("GET /daily error:", e);
    res.status(500).json({ error: String(e instanceof Error ? e.message : e) });
  }
});

blackjackRouter.post("/play", async (req, res) => {
  try {
    const modelId = String(req.body?.modelId ?? "").trim();
    if (!modelId) {
      return res.status(400).json({ error: "modelId required" });
    }
    let betCents = Math.round(Number(req.body?.betCents ?? 0));
    if (betCents <= 0) {
      betCents = await getAIBetCents(modelId);
    }
    const result = await playHand(modelId, betCents);
    console.log("Play result:", { decision: result.decision, outcome: result.outcome, pnlCents: result.pnlCents, balanceCentsAfter: result.balanceCentsAfter });
    res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Play failed";
    console.error("Play error:", e);
    const status = message.includes("Insufficient") || message.includes("Unknown") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

/** SSE: single AI — body { modelId, hands }. VS — header X-Blackjack-Mode: vs and body { modelIdA, modelIdB, hands }. Same URL so no 404. */
const PLAY_STREAM_TIMEOUT_MS = 5 * 60 * 1000; // 5 min so long AI runs don't get cut by server timeout

blackjackRouter.post("/play-stream", async (req, res) => {
  const body = req.body ?? {};
  const q = req.query as Record<string, string | undefined>;
  const isVs = (req.get("X-Blackjack-Mode") ?? "").toLowerCase() === "vs";

  if (isVs) {
    const modelIdA = String(body.modelIdA ?? q.modelIdA ?? "").trim();
    const modelIdB = String(body.modelIdB ?? q.modelIdB ?? "").trim();
    const hands = Math.min(100, Math.max(1, Math.round(Number(body.hands ?? q.hands ?? 1))));
    if (!modelIdA || !modelIdB) {
      return res.status(400).json({ error: "modelIdA and modelIdB required" });
    }
    if (modelIdA === modelIdB) {
      return res.status(400).json({ error: "Choose two different models" });
    }
    req.socket?.setTimeout(PLAY_STREAM_TIMEOUT_MS);
    const effectiveMaxBet = config.blackjackMaxBetCents;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    let streamClosed = false;
    const onClose = () => {
      streamClosed = true;
    };
    res.on("close", onClose);
    res.on("error", onClose);
    const sendVs = (ev: StreamEventVs) => {
      if (streamClosed) return;
      try {
        const ok = res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (!ok) res.once("drain", () => {});
      } catch (e) {
        streamClosed = true;
        console.warn("Play-stream VS: client connection lost, continuing hand on server:", e instanceof Error ? e.message : String(e));
      }
    };
    const claimed = claimPendingHand(modelIdA, modelIdB);
    try {
      await playHandsStreamVs(modelIdA, modelIdB, effectiveMaxBet, hands, sendVs);
      if (claimed) setAutoPlayLastHandAt();
    } catch (e) {
      if (!streamClosed) sendVs({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      res.removeListener("close", onClose);
      res.removeListener("error", onClose);
      try {
        res.end();
      } catch (_) {}
    }
    return;
  }

  const modelId = String(body.modelId ?? "").trim();
  const hands = Math.min(100, Math.max(1, Math.round(Number(body.hands ?? 1))));
  const maxBetCents = Math.round(Number(body.maxBetCents ?? 0));
  if (!modelId) {
    return res.status(400).json({ error: "modelId required" });
  }
  if (modelId.toLowerCase() === "hedera-knowledge") {
    if (!config.knowledgeInboundTopicId || !config.hederaInboundTopicId) {
      return res.status(400).json({
        error: "Hedera Knowledge not configured. Set KNOWLEDGE_INBOUND_TOPIC_ID and HEDERA_INBOUND_TOPIC_ID in .env.",
      });
    }
  }
  const effectiveMaxBet = maxBetCents > 0 ? maxBetCents : config.blackjackMaxBetCents;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  function send(ev: StreamEvent) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
  try {
    await playHandsStream(modelId, effectiveMaxBet, hands, send);
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
});
