import { randomUUID } from "crypto";
import { credit as creditUserBalance } from "../../user-balance.js";

export type CropNextTestBet = {
  id: string;
  model_a_id: string;
  model_b_id: string;
  direction: "a_wins" | "b_wins";
  amount_cents: number;
  outcome: "pending" | "win" | "loss" | "push";
  payout_cents: number | null;
  created_at: string;
};

export type CropLongTermBet = {
  id: string;
  model_id: string;
  period: string;
  prediction_bu_per_acre: number | null;
  direction: "yes" | "no";
  amount_cents: number;
  outcome: "pending" | "win" | "loss";
  payout_cents: number | null;
  created_at: string;
};

const cropNextTestBets: CropNextTestBet[] = [];
const cropLongTermBets: CropLongTermBet[] = [];

export function placeCropNextTestBet(
  modelAId: string,
  modelBId: string,
  direction: "a_wins" | "b_wins",
  amountCents: number
): CropNextTestBet {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const bet: CropNextTestBet = {
    id,
    model_a_id: modelAId,
    model_b_id: modelBId,
    direction,
    amount_cents: amountCents,
    outcome: "pending",
    payout_cents: null,
    created_at,
  };
  cropNextTestBets.push(bet);
  return bet;
}

export function listCropNextTestBets(): CropNextTestBet[] {
  return cropNextTestBets.map((b) => ({ ...b }));
}

/** Settle all pending crop next-test bets for this (modelAId, modelBId) run. Parimutuel; tie = push refund. */
export function settleCropNextTestBets(
  modelAId: string,
  modelBId: string,
  finalValueCentsA: number,
  finalValueCentsB: number
): void {
  const startValueCents = 10_000_000; // $100k
  const pnlA = finalValueCentsA - startValueCents;
  const pnlB = finalValueCentsB - startValueCents;
  const aWins = pnlA > pnlB;
  const bWins = pnlB > pnlA;
  const isTie = pnlA === pnlB;

  const pending = cropNextTestBets.filter(
    (b) =>
      b.outcome === "pending" &&
      b.model_a_id === modelAId &&
      b.model_b_id === modelBId
  );
  if (pending.length === 0) return;

  let totalACents = 0;
  let totalBCents = 0;
  for (const b of cropNextTestBets) {
    if (b.model_a_id !== modelAId || b.model_b_id !== modelBId) continue;
    if (b.direction === "a_wins") totalACents += b.amount_cents;
    else totalBCents += b.amount_cents;
  }
  const totalPool = totalACents + totalBCents;
  const totalWinning = aWins ? totalACents : bWins ? totalBCents : 0;
  const divisor = totalWinning > 0 ? totalWinning : 1;

  for (const bet of pending) {
    if (isTie) {
      bet.outcome = "push";
      bet.payout_cents = bet.amount_cents;
    } else {
      const win =
        (bet.direction === "a_wins" && aWins) || (bet.direction === "b_wins" && bWins);
      bet.outcome = win ? "win" : "loss";
      bet.payout_cents = win ? Math.round((bet.amount_cents * totalPool) / divisor) : 0;
    }
    creditUserBalance(bet.payout_cents ?? 0);
  }
}

export function placeCropLongTermBet(
  modelId: string,
  period: string,
  predictionBuPerAcre: number | null,
  direction: "yes" | "no",
  amountCents: number
): CropLongTermBet {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const bet: CropLongTermBet = {
    id,
    model_id: modelId,
    period,
    prediction_bu_per_acre: predictionBuPerAcre,
    direction,
    amount_cents: amountCents,
    outcome: "pending",
    payout_cents: null,
    created_at,
  };
  cropLongTermBets.push(bet);
  return bet;
}

export function listCropLongTermBets(): CropLongTermBet[] {
  return cropLongTermBets.map((b) => ({ ...b }));
}

export type CropNextTestOddsPoint = {
  time: string;
  impliedAWinsPct: number;
  totalACents: number;
  totalBCents: number;
};

export function getCropNextTestOddsHistory(
  modelAId: string,
  modelBId: string
): CropNextTestOddsPoint[] {
  const points: CropNextTestOddsPoint[] = [];
  let totalA = 0;
  let totalB = 0;
  const bets = cropNextTestBets
    .filter((b) => b.model_a_id === modelAId && b.model_b_id === modelBId)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  for (const b of bets) {
    if (b.direction === "a_wins") totalA += b.amount_cents;
    else totalB += b.amount_cents;
    const total = totalA + totalB;
    const impliedAWinsPct = total > 0 ? (100 * totalA) / total : 50;
    points.push({
      time: b.created_at ?? "",
      impliedAWinsPct: Math.round(impliedAWinsPct * 10) / 10,
      totalACents: totalA,
      totalBCents: totalB,
    });
  }
  return points;
}

export type CropLongTermOddsPoint = {
  time: string;
  impliedYesPct: number;
  totalYesCents: number;
  totalNoCents: number;
};

export function getCropLongTermOddsHistory(
  modelId: string,
  period: string
): CropLongTermOddsPoint[] {
  const points: CropLongTermOddsPoint[] = [];
  let totalYes = 0;
  let totalNo = 0;
  const bets = cropLongTermBets
    .filter((b) => b.model_id === modelId && b.period === period)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  for (const b of bets) {
    if (b.direction === "yes") totalYes += b.amount_cents;
    else totalNo += b.amount_cents;
    const total = totalYes + totalNo;
    const impliedYesPct = total > 0 ? (100 * totalYes) / total : 50;
    points.push({
      time: b.created_at ?? "",
      impliedYesPct: Math.round(impliedYesPct * 10) / 10,
      totalYesCents: totalYes,
      totalNoCents: totalNo,
    });
  }
  return points;
}
