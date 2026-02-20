import "dotenv/config";
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
import { startAutoPlayBlackjack } from "./jobs/autoPlayBlackjack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const publicDir = path.join(__dirname, "..", "public");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/blackjack", blackjackRouter);
app.use("/api/market", marketRouter);
app.use("/api/crop", cropRouter);
app.use("/api/user", userRouter);

// Production: serve built frontend (SPA) so one deploy = one origin
if (isProduction && publicDir) {
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

// JSON 404 for unknown API routes (and in dev for any unknown path)
app.use((req, res) => res.status(404).json({ error: `Cannot ${req.method} ${req.path}` }));

const server = app.listen(config.port, "0.0.0.0", () => {
  const providers = getAIProviders();
  console.log(`Server listening on http://localhost:${config.port}`);
  console.log(`OpenAI API key: ${config.openaiApiKey ? "set" : "NOT SET (add OPENAI_API_KEY to .env in project root)"}`);
  console.log(`AI models loaded: ${providers.length} (${providers.map((p) => p.name).join(", ")})`);
  if (config.hederaOperatorId && config.hederaOperatorKey && config.hederaTopicId) {
    console.log(`HCS: AI results will be submitted to topic ${config.hederaTopicId}`);
  }
  startAutoPlayBlackjack();
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${config.port} is already in use. Either:`);
    console.error(`  1) Stop the other process: in PowerShell run  taskkill /PID <pid> /F  (find <pid> with  netstat -ano | findstr :4000)`);
    console.error(`  2) Or use another port: add  PORT=4001  to .env and  VITE_API_URL=http://127.0.0.1:4001  then restart backend and refresh frontend.\n`);
  }
  throw err;
});
