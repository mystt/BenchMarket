/**
 * Create an HCS topic for AI benchmark results. Run from project root or backend:
 *   npx tsx backend/src/hedera/create-topic.ts
 *   or: npm run hcs:create-topic  (from backend dir)
 *
 * Requires in .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK (optional, default testnet).
 * Prints the new topic ID to add to .env as HEDERA_TOPIC_ID.
 */

import { join } from "path";
import { config as loadEnv } from "dotenv";
loadEnv({ path: join(process.cwd(), "..", ".env") });
loadEnv({ path: join(process.cwd(), ".env") });

import { Client, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";
import { config } from "../config.js";

async function main() {
  const { hederaOperatorId, hederaOperatorKey, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) {
    console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env (project root or backend)");
    process.exit(1);
  }
  const net = hederaNetwork ?? "testnet";
  const client =
    net === "mainnet"
      ? Client.forMainnet()
      : net === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();
  const key = /^[0-9a-fA-F]{64}$/.test(hederaOperatorKey)
    ? PrivateKey.fromStringED25519(hederaOperatorKey)
    : PrivateKey.fromString(hederaOperatorKey);
  client.setOperator(hederaOperatorId, key);

  const tx = new TopicCreateTransaction().setTopicMemo("AI benchmark results (blackjack, crop, market)");
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const topicId = receipt.topicId;
  if (!topicId) {
    console.error("Topic creation failed: no topicId in receipt");
    process.exit(1);
  }
  const idStr = topicId.toString();
  console.log("HCS topic created.");
  console.log("Add to your .env:");
  console.log("HEDERA_TOPIC_ID=" + idStr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
