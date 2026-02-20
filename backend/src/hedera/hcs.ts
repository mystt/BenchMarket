/**
 * Hedera Consensus Service (HCS): submit AI benchmark results to a topic.
 * When HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_TOPIC_ID are set in .env,
 * results are published so mirror nodes / other services can consume them (e.g. for blockchain integration).
 */

import {
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { config } from "../config.js";

let client: Client | null = null;

function getClient(): Client | null {
  if (client != null) return client;
  const { hederaOperatorId, hederaOperatorKey, hederaNetwork, hederaTopicId } = config;
  if (!hederaOperatorId || !hederaOperatorKey || !hederaTopicId) return null;
  try {
    const net = hederaNetwork ?? "testnet";
    client =
      net === "mainnet"
        ? Client.forMainnet()
        : net === "previewnet"
          ? Client.forPreviewnet()
          : Client.forTestnet();
    // Hedera accounts typically use ED25519; key in .env as hex (64 chars) or DER hex
    const key = /^[0-9a-fA-F]{64}$/.test(hederaOperatorKey)
      ? PrivateKey.fromStringED25519(hederaOperatorKey)
      : PrivateKey.fromString(hederaOperatorKey);
    client.setOperator(hederaOperatorId, key);
    return client;
  } catch (e) {
    console.warn("[HCS] Failed to create Hedera client:", e);
    return null;
  }
}

/** Payload types we publish (domain + result fields). */
export type AiResultPayload =
  | { domain: "blackjack"; handId: string; modelId: string; date: string; betCents: number; outcome: string; pnlCents: number; playerCards: string[]; dealerUpcard: string; decision: string }
  | { domain: "blackjack_vs"; handIdA: string; handIdB: string; modelIdA: string; modelIdB: string; date: string; outcomeA: string; outcomeB: string; pnlA: number; pnlB: number }
  | { domain: "crop"; runId: string; modelId: string; portfolioEndCents: number; bushelsPerAcre?: number }
  | { domain: "market"; type: "day" | "next3"; id: string; outcome: string; payoutCents?: number };

const MAX_MESSAGE_BYTES = 1024;

/**
 * Submit an AI result message to the HCS topic. No-op if Hedera env is not configured.
 * Fire-and-forget: errors are logged and not thrown so game flow is not blocked.
 */
export async function submitAiResult(payload: AiResultPayload): Promise<void> {
  const c = getClient();
  if (!c) return;
  const topicId = config.hederaTopicId!;
  const client = c;
  const message = JSON.stringify({ ts: new Date().toISOString(), ...payload });
  const bytes = new TextEncoder().encode(message);
  if (bytes.length > MAX_MESSAGE_BYTES) {
    console.warn("[HCS] Message too long, truncating:", bytes.length);
    const truncated = JSON.stringify({ ...payload, _truncated: true });
    await submitRaw(truncated.slice(0, MAX_MESSAGE_BYTES - 50));
  } else {
    await submitRaw(message);
  }

  async function submitRaw(msg: string): Promise<void> {
    try {
      const tx = new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(msg);
      await tx.execute(client);
    } catch (e) {
      console.warn("[HCS] Submit failed:", e);
    }
  }
}
