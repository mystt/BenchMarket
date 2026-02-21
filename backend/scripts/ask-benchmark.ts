/**
 * Submit a benchmark question to the inbound HCS topic.
 * The backend (when running) will receive it and trigger the Benchmark Analyst.
 *
 * Run: npx tsx backend/scripts/ask-benchmark.ts "Which AI is performing best?"
 * Or:  npm run hcs:ask -- "Summarize and grade each model"
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_INBOUND_TOPIC_ID in .env
 */

import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { config } from "../src/config.js";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.log("Usage: npx tsx backend/scripts/ask-benchmark.ts \"Your question here\"");
    console.log("Example: npx tsx backend/scripts/ask-benchmark.ts \"Which AI is performing best?\"");
    process.exit(1);
  }

  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork, hederaInboundTopicId } = config;
  if (!hederaOperatorId || !hederaOperatorKey || !hederaInboundTopicId) {
    console.error("Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_INBOUND_TOPIC_ID in .env");
    process.exit(1);
  }

  // Submit as JSON so it's always parsed as a question
  const payload = JSON.stringify({ question });

  const net = hederaNetwork ?? "testnet";
  const client =
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

  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(hederaInboundTopicId))
    .setMessage(payload);

  await tx.execute(client);
  console.log("Question submitted to inbound topic:", hederaInboundTopicId);
  console.log("Check your backend logs for the Benchmark Analyst response.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
