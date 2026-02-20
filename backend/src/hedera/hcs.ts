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

/** Compact snapshot without long text fields (for HCS 1024-byte limit). */
function compactCropSnapshot(snap: Record<string, unknown>): Record<string, unknown> {
  return {
    date: snap.date,
    pricePerBushel: snap.pricePerBushel,
    cashCents: snap.cashCents,
    bushels: snap.bushels,
    valueCents: snap.valueCents,
    trade: snap.trade,
    size: snap.size,
    // omit reasoning, reasonLongTerm, longTermBushelsPerAcre to fit 1024 bytes
  };
}

function buildMessage(payload: AiResultPayload): string {
  const obj = { v: HCS_SCHEMA_VERSION, ts: new Date().toISOString(), ...payload };
  const msg = JSON.stringify(obj);
  if (new TextEncoder().encode(msg).length <= MAX_MESSAGE_BYTES) return msg;

  // crop_decision: use compact snapshots (no reasoning) to fit
  if (payload.domain === "crop_decision") {
    const compact = {
      v: HCS_SCHEMA_VERSION,
      ts: new Date().toISOString(),
      domain: "crop_decision",
      modelAId: payload.modelAId,
      modelBId: payload.modelBId,
      snapshotA: compactCropSnapshot(payload.snapshotA as Record<string, unknown>),
      snapshotB: compactCropSnapshot(payload.snapshotB as Record<string, unknown>),
    };
    const compactMsg = JSON.stringify(compact);
    if (new TextEncoder().encode(compactMsg).length <= MAX_MESSAGE_BYTES) return compactMsg;
    console.warn("[HCS] crop_decision still too large after compact, skipping");
    return "";
  }

  console.warn("[HCS] Message too long, cannot compact:", payload.domain, "skipping");
  return "";
}

/**
 * Submit an AI result message to the HCS topic. No-op if Hedera env is not configured.
 * Fire-and-forget: errors are logged and not thrown so game flow is not blocked.
 * Crop decision snapshots are compacted (no reasoning text) to stay under 1024 bytes.
 */
export async function submitAiResult(payload: AiResultPayload): Promise<void> {
  const c = getClient();
  if (!c) return;
  const topicId = config.hederaTopicId!;
  const client = c;
  const message = buildMessage(payload);
  if (!message) return;

  try {
    const tx = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message);
    await tx.execute(client);
    if (payload.domain === "blackjack") {
      console.log("[HCS] Submitted blackjack:", (payload as { modelId?: string }).modelId, (payload as { date?: string }).date);
    } else if (payload.domain === "blackjack_vs") {
      console.log("[HCS] Submitted blackjack_vs:", (payload as { modelIdA?: string }).modelIdA, "vs", (payload as { modelIdB?: string }).modelIdB, (payload as { date?: string }).date);
    } else if (payload.domain === "crop_decision") {
      console.log("[HCS] Submitted crop_decision:", payload.modelAId, "vs", payload.modelBId);
    }
  } catch (e) {
    console.warn("[HCS] Submit failed:", e);
  }
}
