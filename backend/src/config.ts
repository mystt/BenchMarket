import { join } from "path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// Load .env: try repo root (parent of backend) then backend dir (Render cwd)
loadEnv({ path: join(process.cwd(), "..", ".env") });
loadEnv({ path: join(process.cwd(), ".env") });

const env = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  BLACKJACK_DAILY_CENTS: z.coerce.number().default(10_000_000), // 100k
  BLACKJACK_MIN_BET_CENTS: z.coerce.number().default(100),   // $1
  BLACKJACK_MAX_BET_CENTS: z.coerce.number().default(100_000), // $1000
  SPORTS_DAILY_CENTS: z.coerce.number().default(10_000_000),   // 100k
  CROP_BANKROLL_CENTS: z.coerce.number().default(10_000_000), // 100k
  /** Delay in ms between each auto-play hand (0 = off). e.g. 300000 = 5 min so users can bet and we save credits */
  AUTO_PLAY_DELAY_MS: z.coerce.number().default(300000),
  /** Bet size per auto-play hand when AI doesn't decide (cents). e.g. 1000 = $10 */
  AUTO_PLAY_BET_CENTS: z.coerce.number().default(1000),
  /** Hedera HCS: operator account id (e.g. 0.0.1234). If set with key/topic, AI results are submitted to the topic. */
  HEDERA_OPERATOR_ID: z.string().optional(),
  /** Hedera operator private key (ED25519 hex or DER). */
  HEDERA_OPERATOR_KEY: z.string().optional(),
  /** Hedera network: testnet | mainnet | previewnet. */
  HEDERA_NETWORK: z.enum(["testnet", "mainnet", "previewnet"]).default("testnet"),
  /** HCS topic id (e.g. 0.0.5678). Required to submit AI results. */
  HEDERA_TOPIC_ID: z.string().optional(),
}).parse(process.env);

const useSqlite = !env.DATABASE_URL || env.DATABASE_URL === "sqlite" || (typeof env.DATABASE_URL === "string" && env.DATABASE_URL.startsWith("file:"));

export const config = {
  port: env.PORT,
  useSqlite,
  databaseUrl: env.DATABASE_URL ?? "sqlite",
  /** SQLite file path when useSqlite is true */
  sqlitePath: "data/benchmark.db",
  openaiApiKey: env.OPENAI_API_KEY,
  /** Daily bankroll per AI in cents (100_000_00 = $100,000) */
  blackjackDailyCents: env.BLACKJACK_DAILY_CENTS,
  blackjackMinBetCents: env.BLACKJACK_MIN_BET_CENTS,
  blackjackMaxBetCents: env.BLACKJACK_MAX_BET_CENTS,
  sportsDailyCents: env.SPORTS_DAILY_CENTS,
  cropBankrollCents: env.CROP_BANKROLL_CENTS,
  autoPlayDelayMs: env.AUTO_PLAY_DELAY_MS,
  autoPlayBetCents: env.AUTO_PLAY_BET_CENTS,
  /** Hedera HCS: when all set, submit AI results to HEDERA_TOPIC_ID */
  hederaOperatorId: env.HEDERA_OPERATOR_ID,
  hederaOperatorKey: env.HEDERA_OPERATOR_KEY,
  hederaNetwork: env.HEDERA_NETWORK,
  hederaTopicId: env.HEDERA_TOPIC_ID,
} as const;

export const DAILY_BLACKJACK_DOLLARS = config.blackjackDailyCents / 100;
export const DAILY_SPORTS_DOLLARS = config.sportsDailyCents / 100;
export const CROP_BANKROLL_DOLLARS = config.cropBankrollCents / 100;
