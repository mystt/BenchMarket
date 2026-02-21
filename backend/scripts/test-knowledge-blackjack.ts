/**
 * Test that the Hedera Knowledge topic can play a hand of blackjack.
 * Sends a prompt (with rules) to KNOWLEDGE_INBOUND_TOPIC_ID; response arrives on HEDERA_INBOUND_TOPIC_ID.
 *
 * Run: npm run hcs:test-knowledge-blackjack
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, KNOWLEDGE_INBOUND_TOPIC_ID, HEDERA_INBOUND_TOPIC_ID in .env
 */

import {
  Client,
  PrivateKey,
  TopicId,
  TopicMessageQuery,
  Timestamp,
  SubscriptionHandle,
} from "@hashgraph/sdk";
import { config } from "../src/config.js";
import {
  askKnowledge,
  resolveKnowledgeResponse,
  parseKnowledgeResponseRequestId,
} from "../src/hedera/knowledge-agent.js";
import { buildBlackjackPromptWithRules } from "../src/domains/blackjack/prompt.js";
import type { Card } from "../src/domains/blackjack/engine.js";

function getClient(): Client | null {
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) return null;
  const net = hederaNetwork ?? "testnet";
  const c =
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
  c.setOperator(hederaOperatorId, key);
  return c;
}

async function main() {
  const { knowledgeInboundTopicId, hederaInboundTopicId } = config;
  if (!knowledgeInboundTopicId || !hederaInboundTopicId) {
    console.error("Set KNOWLEDGE_INBOUND_TOPIC_ID and HEDERA_INBOUND_TOPIC_ID in .env");
    process.exit(1);
  }

  const client = getClient();
  if (!client) {
    console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
    process.exit(1);
  }

  const playerCards: Card[] = ["10S", "6H"];
  const dealerUpcard: Card = "KD";
  const prompt = buildBlackjackPromptWithRules(playerCards, dealerUpcard);

  console.log("[Test] Subscribing to inbound topic", hederaInboundTopicId, "to receive response...");
  const startTime = new Date();

  let subscriptionHandle: SubscriptionHandle | null = null;
  subscriptionHandle = new TopicMessageQuery()
    .setTopicId(TopicId.fromString(hederaInboundTopicId))
    .setStartTime(Timestamp.fromDate(startTime))
    .subscribe(
      client,
      (_msg, err) => {
        if (err) console.error("Subscription error:", err);
      },
      (msg) => {
        try {
          const contents = Buffer.from(msg.contents).toString("utf-8");
          const requestId = parseKnowledgeResponseRequestId(contents);
          if (requestId) resolveKnowledgeResponse(requestId, contents);
        } catch {
          /* skip */
        }
      }
    );

  console.log("[Test] Sending blackjack hand to knowledge topic (player 16 vs dealer K)...");
  try {
    const response = await askKnowledge(prompt);
    console.log("✅ Knowledge topic responded:", response);
    const decisionMatch = response.match(/DECISION:\s*(\w+)/i);
    const decision = decisionMatch?.[1] ?? response.split(/\s+/)[0];
    console.log("   Parsed decision:", decision);
  } catch (e) {
    console.error("❌", e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    subscriptionHandle?.unsubscribe();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
