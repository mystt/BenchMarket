/**
 * Hedera Mirror Node: fetch HCS topic messages.
 * Used to hydrate in-memory stores from the indexed topic (HIP-991 compatible).
 */

import { config } from "../config.js";

function getMirrorBase(): string | null {
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
  links?: { next?: string | { href?: string } };
};

/**
 * Fetch messages from a topic. Messages are base64-encoded JSON.
 * Paginates through links.next to fetch all messages (mirror node typically caps at 100 per request).
 * @param topicIdOverride — use this topic instead of config.hederaTopicId (e.g. inbound topic 0.0.911)
 */
export async function fetchTopicMessages(options?: {
  limit?: number;
  order?: "asc" | "desc";
  maxMessages?: number;
  topicIdOverride?: string;
}): Promise<TopicMessage[]> {
  const topicId = options?.topicIdOverride ?? config.hederaTopicId;
  const base = getMirrorBase();
  if (!base || !topicId) return [];

  const limit = Math.min(options?.limit ?? 100, 100); // mirror often caps at 100
  const order = options?.order ?? "asc";
  const maxMessages = options?.maxMessages ?? 5000;
  const out: TopicMessage[] = [];
  let nextUrl: string | null = `${base}/api/v1/topics/${topicId}/messages?limit=${limit}&order=${order}`;

  try {
    while (nextUrl && out.length < maxMessages) {
      const res = await fetch(nextUrl);
      if (!res.ok) {
        console.warn("[HCS Mirror] Fetch failed:", res.status, res.statusText);
        break;
      }
      const data = (await res.json()) as TopicMessagesResponse;
      const raw = data.messages ?? [];
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
      const next = data.links?.next;
      const nextHref =
        typeof next === "string"
          ? next
          : next && typeof next === "object" && "href" in next
            ? (next as { href?: string }).href
            : null;
      nextUrl =
        nextHref && nextHref.length > 0
          ? nextHref.startsWith("http")
            ? nextHref
            : base + nextHref
          : null;
    }
    return out;
  } catch (e) {
    console.warn("[HCS Mirror] Fetch error:", e);
    return out;
  }
}

/** Fetch messages from the inbound topic (HEDERA_INBOUND_TOPIC_ID, e.g. 0.0.911). */
export async function fetchInboundTopicMessages(options?: {
  limit?: number;
  order?: "asc" | "desc";
  maxMessages?: number;
}): Promise<TopicMessage[]> {
  const topicId = config.hederaInboundTopicId;
  if (!topicId) return [];
  return fetchTopicMessages({ ...options, topicIdOverride: topicId });
}
