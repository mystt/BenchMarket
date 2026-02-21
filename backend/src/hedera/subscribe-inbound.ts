/**
 * Subscribe to HCS inbound topic (HEDERA_INBOUND_TOPIC_ID) via TopicMessageQuery.
 * Real-time messages for user bets/profile. Uses mirror node gRPC stream.
 */

import {
  Client,
  PrivateKey,
  TopicId,
  TopicMessageQuery,
  Timestamp,
  SubscriptionHandle,
} from "@hashgraph/sdk";
import { config } from "../config.js";

let subscribeClient: Client | null = null;
let subscriptionHandle: SubscriptionHandle | null = null;

function getSubscribeClient(): Client | null {
  if (subscribeClient != null) return subscribeClient;
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork, hederaInboundTopicId } = config;
  if (!hederaOperatorId || !hederaOperatorKey || !hederaInboundTopicId) return null;
  try {
    const net = hederaNetwork ?? "testnet";
    subscribeClient =
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
    subscribeClient.setOperator(hederaOperatorId, key);
    return subscribeClient;
  } catch (e) {
    console.warn("[HCS Subscribe] Failed to create client:", e);
    return null;
  }
}

export type InboundMessageHandler = (message: { contents: string; consensusTimestamp: string; sequenceNumber: number }) => void;

/**
 * Start subscribing to the inbound topic. Call on startup when HEDERA_INBOUND_TOPIC_ID is set.
 * @param onMessage — called for each new message (contents decoded as UTF-8)
 * @returns unsubscribe function, or null if not configured
 */
export function startInboundSubscription(onMessage?: InboundMessageHandler): (() => void) | null {
  const topicId = config.hederaInboundTopicId;
  const client = getSubscribeClient();
  if (!topicId || !client) return null;

  const subscriptionStartTime = new Date();

  subscriptionHandle = new TopicMessageQuery()
    .setTopicId(TopicId.fromString(topicId))
    .setStartTime(Timestamp.fromDate(subscriptionStartTime))
    .subscribe(
      client,
      (message, error) => {
        if (error) {
          console.error("❌ Topic subscription error:", error);
          return;
        }
      },
      (message) => {
        try {
          const contents = Buffer.from(message.contents).toString("utf-8");
          const consensusTimestamp = message.consensusTimestamp.toDate().toISOString();
          const sequenceNumber = message.sequenceNumber.toNumber();
          if (onMessage) {
            onMessage({ contents, consensusTimestamp, sequenceNumber });
          } else {
            console.log("[HCS Inbound] Message:", sequenceNumber, contents.slice(0, 100) + (contents.length > 100 ? "…" : ""));
          }
        } catch (e) {
          console.warn("[HCS Inbound] Failed to decode message:", e);
        }
      }
    );

  console.log(`[HCS Inbound] Subscribed to topic ${topicId} (from ${subscriptionStartTime.toISOString()})`);
  return () => {
    if (subscriptionHandle) {
      subscriptionHandle.unsubscribe();
      subscriptionHandle = null;
    }
  };
}
