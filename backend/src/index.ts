import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { getAIProviders } from "./ai/index.js";
import { blackjackRouter } from "./api/blackjack.js";
import { marketRouter } from "./api/market.js";
import { cropRouter } from "./api/crop.js";
import { userRouter } from "./api/user.js";
import { hederaRouter } from "./api/hedera.js";
import { startAutoPlayBlackjack } from "./jobs/autoPlayBlackjack.js";
import { startAutoPlayCrop } from "./jobs/autoPlayCrop.js";
import { hydrateFromHedera } from "./hedera/hydrate.js";
import { startInboundSubscription } from "./hedera/subscribe-inbound.js";
import { invokeBenchmarkAnalyst, parseAnalystQuestion } from "./prompts/benchmark-analyst.js";
import {
  resolveKnowledgeResponse,
  parseKnowledgeResponseRequestId,
} from "./hedera/knowledge-agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const publicDir = path.join(__dirname, "..", "public");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    openaiConfigured: !!(config.openaiApiKey ?? process.env.OPENAI_API_KEY),
  })
);

app.use("/api/blackjack", blackjackRouter);
app.use("/api/market", marketRouter);
app.use("/api/crop", cropRouter);
app.use("/api/user", userRouter);
app.use("/api/hedera", hederaRouter);

// Production: serve built frontend only if present (optional for split Vercel+Render deploy)
const indexPath = path.join(publicDir, "index.html");
if (isProduction && fs.existsSync(indexPath)) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(indexPath));
}

// JSON 404 for unknown API routes (and in dev for any unknown path)
app.use((req, res) => res.status(404).json({ error: `Cannot ${req.method} ${req.path}` }));

async function main() {
  if (config.hederaTopicId) {
    try {
      await hydrateFromHedera();
      console.log("HCS: Hydrated state from topic", config.hederaTopicId);
    } catch (e) {
      console.warn("HCS: Hydration failed:", e);
    }
  }
  const server = app.listen(config.port, "0.0.0.0", () => {
    const providers = getAIProviders();
    console.log(`Server listening on http://localhost:${config.port}`);
    console.log(`OpenAI API key: ${config.openaiApiKey ? "set" : "NOT SET (add OPENAI_API_KEY to .env in project root)"}`);
    console.log(`AI models loaded: ${providers.length} (${providers.map((p) => p.name).join(", ")})`);
    if (config.hederaOperatorId && config.hederaOperatorKey && config.hederaTopicId) {
      console.log(`HCS: AI results will be submitted to topic ${config.hederaTopicId}`);
    }
    if (config.hederaInboundTopicId) {
      startInboundSubscription(async (msg) => {
        // Knowledge topic responses (requestId) — resolve pending ask() calls
        const requestId = parseKnowledgeResponseRequestId(msg.contents);
        if (requestId) {
          resolveKnowledgeResponse(requestId, msg.contents);
          return;
        }
        // Benchmark analyst triggers
        const q = parseAnalystQuestion(msg.contents);
        if (q) {
          console.log("[HCS Inbound] Triggering benchmark analyst:", q.slice(0, 60) + (q.length > 60 ? "…" : ""));
          const analysis = await invokeBenchmarkAnalyst(q);
          console.log("[Benchmark Analyst]", analysis.slice(0, 300) + (analysis.length > 300 ? "…" : ""));
        } else {
          console.log("[HCS Inbound] Message:", msg.sequenceNumber, msg.contents.slice(0, 100) + (msg.contents.length > 100 ? "…" : ""));
        }
      });
    }
    startAutoPlayBlackjack();
    startAutoPlayCrop();
  });
  return server;
}
main()
  .then((server) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`\nPort ${config.port} is already in use. Either:`);
        console.error(`  1) Stop the other process: in PowerShell run  taskkill /PID <pid> /F  (find <pid> with  netstat -ano | findstr :4000)`);
        console.error(`  2) Or use another port: add  PORT=4001  to .env and  VITE_API_URL=http://127.0.0.1:4001  then restart backend and refresh frontend.\n`);
      }
      throw err;
    });
  })
  .catch((e) => {
    console.error("Startup failed:", e);
    process.exit(1);
  });
