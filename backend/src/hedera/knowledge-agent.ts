/**
 * Hedera Knowledge Topic as LLM — we send prompts, it responds like an AI.
 * We publish to KNOWLEDGE_INBOUND_TOPIC_ID; responses arrive on HEDERA_INBOUND_TOPIC_ID.
 */

import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { config } from "../config.js";
import { buildBlackjackPromptWithRules } from "../domains/blackjack/prompt.js";
import type { Card } from "../domains/blackjack/engine.js";

let client: Client | null = null;

function getClient(): Client | null {
  if (client != null) return client;
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) return null;
  try {
    const net = hederaNetwork ?? "testnet";
    client =
      net === "mainnet"
        ? Client.forMainnet()
        : net === "previewnet"
          ? Client.forPreviewnet()
          : Client.forTestnet();
    const keyStr = hederaOperatorKey.replace(/\s/g, "").trim().replace(/^0x/i, "");
    const key =
      /^[0-9a-fA-F]{64}$/.test(keyStr)
        ? (hederaKeyType === "ed25519" ? PrivateKey.fromStringED25519(keyStr) : PrivateKey.fromStringECDSA(keyStr))
        : /^302[ce][0-9a-fA-F]+$/.test(keyStr) || (keyStr.length > 64 && /^[0-9a-fA-F]+$/.test(keyStr))
          ? PrivateKey.fromStringDer(keyStr)
          : PrivateKey.fromString(hederaOperatorKey);
    client.setOperator(hederaOperatorId, key);
    return client;
  } catch (e) {
    console.warn("[Knowledge] Failed to create client:", e);
    return null;
  }
}

/** Pending ask() calls waiting for response. requestId -> { resolve, reject, timeout } */
const pending = new Map<
  string,
  { resolve: (text: string) => void; reject: (err: Error) => void; timeout: ReturnType<typeof setTimeout> }
>();

const PENDING_TIMEOUT_MS = 60_000;

/**
 * Call when inbound message is received. Resolves matching pending ask().
 */
export function resolveKnowledgeResponse(requestId: string, contents: string): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  pending.delete(requestId);
  entry.resolve(contents);
}

/** Parse requestId from inbound message. Returns null if not a knowledge response. */
export function parseKnowledgeResponseRequestId(contents: string): string | null {
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    const id = parsed.requestId ?? parsed.request_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Extract response text from message. Handles JSON { content, text, response } or raw. */
function extractResponseText(contents: string): string {
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    const text =
      (parsed.content ?? parsed.text ?? parsed.response ?? parsed.message) as string | undefined;
    if (typeof text === "string") return text;
  } catch {
    /* not JSON */
  }
  return contents;
}

/** Optional HCS metadata for blackjack (multi-message hand). */
export type KnowledgeRequestMeta = {
  type: "blackjack_decision";
  handId: string;
  step: number;
  playerCards: string[];
  dealerUpcard: string;
  betCents?: number;
};

/**
 * Send a prompt to the knowledge topic (acts like an LLM) and wait for response.
 * For blackjack, pass meta so each message includes handId/step and task="blackjack".
 * @returns response text, or throws on timeout/error
 */
export async function askKnowledge(prompt: string, meta?: KnowledgeRequestMeta): Promise<string> {
  const topicId = config.knowledgeInboundTopicId;
  const replyTo = config.hederaInboundTopicId;
  const c = getClient();

  if (!topicId || !replyTo || !c) {
    throw new Error("KNOWLEDGE_INBOUND_TOPIC_ID and HEDERA_INBOUND_TOPIC_ID required");
  }

  const requestId = crypto.randomUUID();
  const payload = meta
    ? { ...meta, requestId, prompt, replyTo, task: "blackjack" as const }
    : { type: "llm_request", requestId, prompt, replyTo, task: "blackjack" as const };

  let msg = JSON.stringify(payload);
  if (new TextEncoder().encode(msg).length > 1024) {
    (payload as { prompt: string }).prompt = prompt.slice(0, 400) + "...";
    msg = JSON.stringify(payload);
  }

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(requestId)) {
        reject(new Error("Knowledge topic response timeout (60s)"));
      }
    }, PENDING_TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timeout });

    new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(msg)
      .execute(c)
      .then(() => {
        console.log("[Knowledge] Sent request", requestId.slice(0, 8) + "...");
      })
      .catch((err) => {
        if (pending.delete(requestId)) {
          clearTimeout(timeout);
          reject(err);
        }
      });
  }).then((contents) => extractResponseText(contents));
}

/**
 * Ask the knowledge topic to play a blackjack hand. Uses prompt with rules.
 */
export async function askKnowledgeBlackjack(playerCards: Card[], dealerUpcard: Card): Promise<string> {
  const prompt = buildBlackjackPromptWithRules(playerCards, dealerUpcard);
  return askKnowledge(prompt);
}
