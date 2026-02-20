/**
 * HCS message scheme for AI benchmark data.
 * Stored on Hedera topic; mirror node indexes for hydration.
 *
 * Format: { v: number, ts: string, domain: string, ...payload }
 * - v: schema version (1). Future changes bump v.
 * - ts: ISO timestamp when submitted
 * - domain: discriminator for payload shape
 *
 * Hydration uses: blackjack, blackjack_vs, crop_decision
 * Charts pull from in-memory state rebuilt by hydration.
 */

export const HCS_SCHEMA_VERSION = 1;

/** Blackjack: single hand (model plays alone) */
export type BlackjackPayload = {
  domain: "blackjack";
  handId: string;
  modelId: string;
  date: string; // YYYY-MM-DD
  betCents: number;
  outcome: "win" | "loss" | "push";
  pnlCents: number;
  playerCards: string[];
  dealerUpcard: string;
  decision: string;
};

/** Blackjack VS: two models, same table */
export type BlackjackVsPayload = {
  domain: "blackjack_vs";
  handIdA: string;
  handIdB: string;
  modelIdA: string;
  modelIdB: string;
  date: string;
  outcomeA: string;
  outcomeB: string;
  pnlA: number;
  pnlB: number;
  /** Card data for decision history display */
  playerACards?: string[];
  playerBCards?: string[];
  dealerUpcard?: string;
  dealerCards?: string[];
  dealerTotal?: number;
  betA?: number;
  betB?: number;
  decisionA?: string;
  decisionB?: string;
};

/** Crop portfolio snapshot (one decision per model) */
export type CropSnapshotPayload = {
  date: string;
  pricePerBushel: number;
  cashCents: number;
  bushels: number;
  valueCents: number;
  trade?: string;
  size?: number;
  reasoning?: string | null;
  longTermBushelsPerAcre?: number | null;
  reasonLongTerm?: string | null;
};

/** Crop VS: one step (both models decide on same price) */
export type CropDecisionPayload = {
  domain: "crop_decision";
  modelAId: string;
  modelBId: string;
  snapshotA: CropSnapshotPayload;
  snapshotB: CropSnapshotPayload;
};

/** Crop: legacy run-level result */
export type CropPayload = {
  domain: "crop";
  runId: string;
  modelId: string;
  portfolioEndCents: number;
  bushelsPerAcre?: number;
};

/** Market bet outcome */
export type MarketPayload = {
  domain: "market";
  type: "day" | "next3";
  id: string;
  outcome: string;
  payoutCents?: number;
};

export type HcsPayload =
  | BlackjackPayload
  | BlackjackVsPayload
  | CropDecisionPayload
  | CropPayload
  | MarketPayload;

export type HcsMessage = {
  v: number;
  ts: string;
} & HcsPayload;
