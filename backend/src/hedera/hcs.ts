/**
 * Hedera Consensus Service (HCS): submit AI benchmark results to a topic.
 * When HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_TOPIC_ID are set in .env,
 * results are published so mirror nodes / other services can consume them (e.g. for blockchain integration).
 *
 * Message format: { v: 1, ts: ISO, domain, ...payload } — see schema.ts
 */

import {
  Client,
  PrivateKey,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { config } from "../config.js";
import { HCS_SCHEMA_VERSION } from "./schema.js";
import type { HcsPayload } from "./schema.js";

// Re-export for consumers
export type { CropSnapshotPayload } from "./schema.js";

let client: Client | null = null;

function getClient(): Client | null {
  if (client != null) return client;
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork, hederaTopicId } = config;
  if (!hederaOperatorId || !hederaOperatorKey || !hederaTopicId) return null;
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
    console.warn("[HCS] Failed to create Hedera client:", e);
    return null;
  }
}

/** Payload to submit (same as HcsPayload from schema). */
export type AiResultPayload = HcsPayload;

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
  const message = JSON.stringify({ v: HCS_SCHEMA_VERSION, ts: new Date().toISOString(), ...payload });
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
