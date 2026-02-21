/**
 * Test the HCS inbound topic subscription.
 * Run: npx tsx backend/scripts/test-inbound-subscription.ts
 *
 * 1. Starts the subscription
 * 2. Submits a test message to the inbound topic
 * 3. Waits to see if the subscription receives it
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, HEDERA_INBOUND_TOPIC_ID in .env
 */

import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { config } from "../src/config.js";
import { startInboundSubscription } from "../src/hedera/subscribe-inbound.js";

async function main() {
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork, hederaInboundTopicId } = config;
  if (!hederaOperatorId || !hederaOperatorKey || !hederaInboundTopicId) {
    console.error("Set HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, and HEDERA_INBOUND_TOPIC_ID in .env");
    process.exit(1);
  }

  let received = false;
  const testPayload = JSON.stringify({
    test: true,
    ts: new Date().toISOString(),
    msg: "inbound subscription test",
  });

  const unsubscribe = startInboundSubscription((msg) => {
    if (msg.contents.includes('"test":true') || msg.contents.includes("inbound subscription test")) {
      received = true;
      console.log("✅ Subscription received test message:", msg.contents.slice(0, 80) + "...");
    }
  });

  if (!unsubscribe) {
    console.error("Failed to start subscription (check HEDERA_INBOUND_TOPIC_ID)");
    process.exit(1);
  }

  console.log("[Test] Subscription started. Submitting test message to topic", hederaInboundTopicId, "...");

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
    .setMessage(testPayload);
  await tx.execute(client);
  console.log("[Test] Message submitted. Waiting up to 15s for subscription to receive it...");

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (received) {
      console.log("✅ Test passed: subscription is working.");
      unsubscribe();
      process.exit(0);
    }
  }

  console.log("⚠️  No message received within 15s. Subscription may still be connecting, or mirror node may be slow.");
  console.log("   Try running the backend and run this script again – messages are streamed with some delay.");
  unsubscribe();
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
