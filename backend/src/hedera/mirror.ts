/**
 * Hedera Mirror Node: fetch HCS topic messages.
 * Used to hydrate in-memory stores from the indexed topic (HIP-991 compatible).
 */

import { config } from "../config.js";

function getMirrorBase(): string | null {
  if (!config.hederaTopicId) return null;
  const url = process.env.HEDERA_MIRROR_BASE_URL;
  if (url) return url.replace(/\/$/, "");
  const net = config.hederaNetwork ?? "testnet";
  if (net === "mainnet") return "https://mainnet.mirrornode.hedera.com";
  if (net === "previewnet") return "https://previewnet.mirrornode.hedera.com";
  return "https://testnet.mirrornode.hedera.com";
}

export type TopicMessage = {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
};

export type TopicMessagesResponse = {
  messages?: Array<{
    consensus_timestamp?: string;
    sequence_number?: number;
    message?: string;
  }>;
  links?: { next?: string };
};

/**
 * Fetch messages from the topic. Messages are base64-encoded JSON.
 */
export async function fetchTopicMessages(options?: {
  limit?: number;
  order?: "asc" | "desc";
}): Promise<TopicMessage[]> {
  const base = getMirrorBase();
  const topicId = config.hederaTopicId;
  if (!base || !topicId) return [];

  const limit = options?.limit ?? 100;
  const order = options?.order ?? "asc";
  const url = `${base}/api/v1/topics/${topicId}/messages?limit=${limit}&order=${order}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[HCS Mirror] Fetch failed:", res.status, res.statusText);
      return [];
    }
    const data = (await res.json()) as TopicMessagesResponse;
    const raw = data.messages ?? [];
    const out: TopicMessage[] = [];
    for (const m of raw) {
      const msg = m.message;
      if (!msg) continue;
      try {
        const decoded = Buffer.from(msg, "base64").toString("utf-8");
        out.push({
          consensus_timestamp: m.consensus_timestamp ?? "",
          sequence_number: m.sequence_number ?? 0,
          message: decoded,
        });
      } catch {
        /* skip malformed */
      }
    }
    return out;
  } catch (e) {
    console.warn("[HCS Mirror] Fetch error:", e);
    return [];
  }
}
