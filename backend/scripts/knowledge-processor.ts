/**
 * Knowledge topic processor — bridges the knowledge topic to an LLM (OpenAI).
 * Subscribes to KNOWLEDGE_INBOUND_TOPIC_ID; for each blackjack request, calls OpenAI and posts
 * the response to the replyTo topic (HEDERA_INBOUND_TOPIC_ID).
 *
 * Uses blackjack-reference.md as context so the LLM has training/reference data.
 *
 * Run: npm run knowledge-processor
 * Or: cd backend && npx tsx scripts/knowledge-processor.ts
 *
 * Requires: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, KNOWLEDGE_INBOUND_TOPIC_ID,
 *           HEDERA_INBOUND_TOPIC_ID, OPENAI_API_KEY in .env
 *
 * Keep this running (locally or deployed) for "Play 1 hand" to work.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  Client,
  PrivateKey,
  TopicId,
  TopicMessageQuery,
  TopicMessageSubmitTransaction,
  Timestamp,
} from "@hashgraph/sdk";
import OpenAI from "openai";
import { config } from "../src/config.js";

/** Load blackjack reference data to prepend to prompts. */
function loadBlackjackReference(): string {
  const refPath = path.join(__dirname, "..", "src", "domains", "blackjack", "blackjack-reference.md");
  try {
    const content = fs.readFileSync(refPath, "utf-8");
    return content.trim();
  } catch {
    console.warn("[Processor] Could not load blackjack-reference.md, using prompt only");
    return "";
  }
}

function getClient(): Client {
  const { hederaOperatorId, hederaOperatorKey, hederaKeyType, hederaNetwork } = config;
  if (!hederaOperatorId || !hederaOperatorKey) {
    throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY");
  }
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
  return client;
}

async function callOpenAI(prompt: string): Promise<string> {
  const apiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY");
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  return text ?? "";
}

async function processMessage(client: Client, contents: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(contents) as Record<string, unknown>;
  } catch {
    return; // not JSON, ignore
  }
  const task = parsed.task;
  const requestId = parsed.requestId ?? parsed.request_id;
  const replyTo = parsed.replyTo;
  const prompt = parsed.prompt;

  if (task !== "blackjack" || typeof requestId !== "string" || !requestId || typeof replyTo !== "string" || !replyTo) {
    return; // not a request we handle
  }
  if (typeof prompt !== "string" || !prompt) {
    console.warn("[Processor] Missing prompt, skipping requestId", requestId.slice(0, 8));
    return;
  }

  const reference = loadBlackjackReference();
  const fullPrompt = reference
    ? `Use this reference when playing blackjack:\n\n${reference}\n\n---\n\n${prompt}`
    : prompt;

  console.log("[Processor] Blackjack request", requestId.slice(0, 8) + "...", "→ calling OpenAI", reference ? "(with reference)" : "");
  let response: string;
  try {
    response = await callOpenAI(fullPrompt);
  } catch (e) {
    console.error("[Processor] OpenAI error:", e);
    response = "DECISION: stand\nREASONING: Error calling LLM.";
  }

  let payload = JSON.stringify({ requestId, content: response });
  if (new TextEncoder().encode(payload).length > 1024) {
    response = response.slice(0, 900) + "...";
    payload = JSON.stringify({ requestId, content: response });
  }

  try {
    const tx = new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(replyTo))
      .setMessage(payload);
    await tx.execute(client);
    console.log("[Processor] Posted response to", replyTo, "requestId", requestId.slice(0, 8) + "...");
  } catch (e) {
    console.error("[Processor] Failed to post response:", e);
  }
}

async function main() {
  const { knowledgeInboundTopicId } = config;
  if (!knowledgeInboundTopicId) {
    console.error("Set KNOWLEDGE_INBOUND_TOPIC_ID in .env");
    process.exit(1);
  }
  if (!config.openaiApiKey && !process.env.OPENAI_API_KEY) {
    console.error("Set OPENAI_API_KEY in .env");
    process.exit(1);
  }

  const client = getClient();
  const startTime = new Date();

  console.log("[Processor] Subscribing to knowledge topic", knowledgeInboundTopicId);
  console.log("[Processor] Listening for blackjack requests. ReplyTo topic:", config.hederaInboundTopicId ?? "(from message)");
  console.log("[Processor] Press Ctrl+C to stop.\n");

  new TopicMessageQuery()
    .setTopicId(TopicId.fromString(knowledgeInboundTopicId))
    .setStartTime(Timestamp.fromDate(startTime))
    .subscribe(
      client,
      (_msg, err) => {
        if (err) console.error("[Processor] Subscription error:", err);
      },
      async (msg) => {
        try {
          const contents = Buffer.from(msg.contents).toString("utf-8");
          await processMessage(client, contents);
        } catch (e) {
          console.error("[Processor] Handler error:", e);
        }
      }
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
