import { Router } from "express";
import { config } from "../config.js";
import { playHand, getBlackjackDailyState, playHandsStream, playHandsStreamVs, getAIBetCents, type StreamEvent, type StreamEventVs } from "../domains/blackjack/service.js";
import { getAIProviders } from "../ai/index.js";

export const blackjackRouter = Router();

/** Always return both models for the dropdown; actual lookup uses getAIProvider(id) when playing */
const MODEL_OPTIONS = [
  { id: "openai-gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "openai-gpt-4o", name: "GPT-4o" },
];

blackjackRouter.get("/models", (_req, res) => {
  res.json({ models: MODEL_OPTIONS });
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
    const effectiveMaxBet = config.blackjackMaxBetCents;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const sendVs = (ev: StreamEventVs) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    try {
      await playHandsStreamVs(modelIdA, modelIdB, effectiveMaxBet, hands, sendVs);
    } catch (e) {
      sendVs({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      res.end();
    }
    return;
  }

  const modelId = String(body.modelId ?? "").trim();
  const hands = Math.min(100, Math.max(1, Math.round(Number(body.hands ?? 1))));
  const maxBetCents = Math.round(Number(body.maxBetCents ?? 0));
  if (!modelId) {
    return res.status(400).json({ error: "modelId required" });
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
