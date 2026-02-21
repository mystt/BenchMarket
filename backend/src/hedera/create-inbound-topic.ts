/**
 * Create an HCS inbound topic for user bets/profile (HIP-991).
 * Run: npx tsx backend/src/hedera/create-inbound-topic.ts
 *
 * Requires in .env: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_NETWORK (optional).
 * Prints the new topic ID to add to .env as HEDERA_INBOUND_TOPIC_ID.
 *
 * To use an existing topic (e.g. 0.0.911), set HEDERA_INBOUND_TOPIC_ID=0.0.911 in .env.
 */

import "./load-env.js";

import { Client, PrivateKey, TopicCreateTransaction } from "@hashgraph/sdk";
import { config } from "../config.js";

async function main() {
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) {
    console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
    process.exit(1);
  }
  const net = hederaNetwork ?? "testnet";
  const client =
    net === "mainnet"
      ? Client.forMainnet()
      : net === "previewnet"
        ? Client.forPreviewnet()
        : Client.forTestnet();
  const keyStr = hederaOperatorKey.replace(/\s/g, "").trim().replace(/^0x/i, "");
  let key: InstanceType<typeof PrivateKey>;
  if (/^[0-9a-fA-F]{64}$/.test(keyStr)) {
    key = hederaKeyType === "ed25519"
      ? PrivateKey.fromStringED25519(keyStr)
      : PrivateKey.fromStringECDSA(keyStr);
  } else if (/^302[ce][0-9a-fA-F]+$/.test(keyStr)) {
    key = PrivateKey.fromStringDer(keyStr);
  } else if (/^[0-9a-fA-F]+$/.test(keyStr) && keyStr.length > 64) {
    key = PrivateKey.fromStringDer(keyStr);
  } else {
    key = PrivateKey.fromString(hederaOperatorKey);
  }
  client.setOperator(hederaOperatorId, key);

  const tx = new TopicCreateTransaction()
    .setTopicMemo("Inbound: user bets, profile. HIP-991 compatible.");
  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const topicId = receipt.topicId;
  if (!topicId) {
    console.error("Topic creation failed: no topicId in receipt");
    process.exit(1);
  }
  const idStr = topicId.toString();
  console.log("HCS inbound topic created.");
  console.log("Add to your .env:");
  console.log("HEDERA_INBOUND_TOPIC_ID=" + idStr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
