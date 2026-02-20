import { randomUUID } from "crypto";
import { query } from "../../db/client.js";
import { config } from "../../config.js";
import { getAIProviders } from "../../ai/index.js";
import { getBlackjackDailyState } from "../blackjack/service.js";
import { credit as creditUserBalance } from "../../user-balance.js";

export type PerformanceBet = {
  id: string;
  domain: string;
  model_id: string;
  period: string;
  direction: "outperform" | "underperform";
  amount_cents: number;
  outcome: "win" | "loss" | "pending";
  payout_cents?: number | null;
};

/** Place a bet on AI performance (e.g. "model X will outperform in blackjack this day"). */
export async function placePerformanceBet(
  domain: string,
  modelId: string,
  period: string,
  direction: "outperform" | "underperform",
  amountCents: number
): Promise<PerformanceBet> {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  await query(
    `INSERT INTO performance_bets (id, domain, model_id, period, direction, amount_cents, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, domain, modelId, period, direction, amountCents, created_at]
  );
  return { id, domain, model_id: modelId, period, direction, amount_cents: amountCents, outcome: "pending" };
}

/** List all performance bets. */
export async function listPerformanceBets(): Promise<PerformanceBet[]> {
  const res = await query<PerformanceBet>(`SELECT id, domain, model_id, period, direction, amount_cents, outcome, payout_cents FROM performance_bets`);
  return res.rows.map((r) => ({ ...r, payout_cents: r.payout_cents != null ? Number(r.payout_cents) : null }));
}

export type OddsHistoryPoint = { time: string; impliedYesPct: number; totalYesCents: number; totalNoCents: number };

/** Get implied probability (Yes %) over time for a market. Builds series from bets in order. */
export async function getOddsHistory(
  domain: string,
  modelId: string,
  period: string
): Promise<OddsHistoryPoint[]> {
  const res = await query<{ direction: string; amount_cents: number; created_at: string }>(
    `SELECT direction, amount_cents, created_at FROM performance_bets WHERE domain = $1 AND model_id = $2 AND period = $3 ORDER BY created_at ASC`,
    [domain, modelId, period]
  );
  const points: OddsHistoryPoint[] = [];
  let totalYes = 0;
  let totalNo = 0;
  for (const row of res.rows) {
    if (row.direction === "outperform") totalYes += Number(row.amount_cents);
    else totalNo += Number(row.amount_cents);
    const total = totalYes + totalNo;
    const impliedYesPct = total > 0 ? (100 * totalYes) / total : 50;
    points.push({
      time: row.created_at ?? "",
      impliedYesPct: Math.round(impliedYesPct * 10) / 10,
      totalYesCents: totalYes,
      totalNoCents: totalNo,
    });
  }
  return points;
}

/** Get daily P/L per model for leaderboard. Period = date YYYY-MM-DD. */
export async function getLeaderboard(domain: string, period: string): Promise<{ modelId: string; name: string; pnlCents: number }[]> {
  if (domain !== "blackjack") return [];
  const providers = getAIProviders();
  const rows: { modelId: string; name: string; pnlCents: number }[] = [];
  for (const p of providers) {
    const state = await getBlackjackDailyState(p.id, period);
    rows.push({ modelId: p.id, name: p.name, pnlCents: state.pnlCents });
  }
  rows.sort((a, b) => b.pnlCents - a.pnlCents);
  return rows;
}

export type LeaderboardHistoryPoint = { handIndex: number; cumulativePnlCents: number };
export type LeaderboardHistorySeries = { modelId: string; name: string; points: LeaderboardHistoryPoint[] };

/** Get cumulative P/L per hand per model for chart. Period = date YYYY-MM-DD. */
export async function getLeaderboardHistory(domain: string, period: string): Promise<LeaderboardHistorySeries[]> {
  if (domain !== "blackjack") return [];
  const res = await query<{ model_id: string; pnl_cents: number }>(
    `SELECT model_id, pnl_cents FROM blackjack_hands WHERE date = $1 ORDER BY created_at ASC`,
    [period]
  );
  const running: Record<string, number> = {};
  const points: Record<string, LeaderboardHistoryPoint[]> = {};
  for (const row of res.rows) {
    const id = row.model_id;
    if (running[id] === undefined) running[id] = 0;
    running[id] += Number(row.pnl_cents);
    if (!points[id]) points[id] = [];
    points[id].push({ handIndex: points[id].length + 1, cumulativePnlCents: running[id] });
  }
  const providers = getAIProviders();
  return Object.entries(points).map(([modelId, pts]) => ({
    modelId,
    name: providers.find((p) => p.id === modelId)?.name ?? modelId,
    points: pts,
  }));
}

/** Settle pending bets for a past period. Uses parimutuel payout: winners share the full pool proportionally. */
export async function settleBetsForPeriod(domain: string, period: string): Promise<void> {
  if (domain !== "blackjack") return;
  const pending = await query<PerformanceBet>(`SELECT id, domain, model_id, period, direction, amount_cents, outcome FROM performance_bets WHERE outcome = 'pending' AND domain = $1 AND period = $2`, [domain, period]);
  const byModel = new Map<string, typeof pending.rows>();
  for (const bet of pending.rows) {
    const mid = bet.model_id;
    if (!byModel.has(mid)) byModel.set(mid, []);
    byModel.get(mid)!.push(bet);
  }
  for (const [modelId, bets] of byModel) {
    const allBets = await query<PerformanceBet>(`SELECT id, direction, amount_cents FROM performance_bets WHERE domain = $1 AND model_id = $2 AND period = $3`, [domain, modelId, period]);
    let totalYes = 0;
    let totalNo = 0;
    for (const b of allBets.rows) {
      if (b.direction === "outperform") totalYes += Number(b.amount_cents);
      else totalNo += Number(b.amount_cents);
    }
    const totalPool = totalYes + totalNo;
    const state = await getBlackjackDailyState(modelId, period);
    const isOutperform = state.pnlCents > 0;
    const totalWinning = isOutperform ? totalYes : totalNo;
    const divisor = totalWinning > 0 ? totalWinning : 1;
    for (const bet of bets) {
      const win = bet.direction === "outperform" ? isOutperform : !isOutperform;
      const payout_cents = win ? Math.round((Number(bet.amount_cents) * totalPool) / divisor) : 0;
      await query(`UPDATE performance_bets SET outcome = $2, payout_cents = $3 WHERE id = $1`, [bet.id, win ? "win" : "loss", payout_cents]);
      creditUserBalance(payout_cents);
    }
  }
}

export type Next3Bet = {
  id: string;
  model_a_id: string;
  model_b_id: string;
  direction: "a_wins" | "b_wins";
  amount_cents: number;
  outcome: "win" | "loss" | "push" | "pending";
  payout_cents?: number | null;
  hands_a_at_bet: number;
  pnl_a_at_bet: number;
  hands_b_at_bet: number;
  pnl_b_at_bet: number;
  date: string;
};

/** Place a bet on who will profit more over the next 3 hands (each model). Settles when both have played 3+ more hands. */
export async function placeNext3Bet(
  modelAId: string,
  modelBId: string,
  direction: "a_wins" | "b_wins",
  amountCents: number
): Promise<Next3Bet> {
  const date = new Date().toISOString().slice(0, 10);
  const stateA = await getBlackjackDailyState(modelAId, date);
  const stateB = await getBlackjackDailyState(modelBId, date);
  const id = randomUUID();
  const created_at = new Date().toISOString();
  await query(
    `INSERT INTO next_3_bets (id, model_a_id, model_b_id, direction, amount_cents, outcome, hands_a_at_bet, pnl_a_at_bet, hands_b_at_bet, pnl_b_at_bet, date, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11)`,
    [id, modelAId, modelBId, direction, amountCents, stateA.handsPlayed, stateA.pnlCents, stateB.handsPlayed, stateB.pnlCents, date, created_at]
  );
  return {
    id,
    model_a_id: modelAId,
    model_b_id: modelBId,
    direction,
    amount_cents: amountCents,
    outcome: "pending",
    hands_a_at_bet: stateA.handsPlayed,
    pnl_a_at_bet: stateA.pnlCents,
    hands_b_at_bet: stateB.handsPlayed,
    pnl_b_at_bet: stateB.pnlCents,
    date,
  };
}

/** Settle and list next-3-hands bets. Settles any pending bet where both models have played 3+ more hands. Parimutuel payout. */
export async function listNext3Bets(): Promise<Next3Bet[]> {
  const res = await query<Next3Bet & { hands_a_at_bet: string; pnl_a_at_bet: string; hands_b_at_bet: string; pnl_b_at_bet: string }>(
    `SELECT id, model_a_id, model_b_id, direction, amount_cents, outcome, hands_a_at_bet, pnl_a_at_bet, hands_b_at_bet, pnl_b_at_bet, date FROM next_3_bets`
  );
  for (const bet of res.rows) {
    if (bet.outcome !== "pending") continue;
    const betDate = String(bet.date ?? new Date().toISOString().slice(0, 10));
    const stateA = await getBlackjackDailyState(bet.model_a_id, betDate);
    const stateB = await getBlackjackDailyState(bet.model_b_id, betDate);
    const handsA = Number(bet.hands_a_at_bet);
    const handsB = Number(bet.hands_b_at_bet);
    const pnlAAtBet = Number(bet.pnl_a_at_bet);
    const pnlBAtBet = Number(bet.pnl_b_at_bet);
    if (stateA.handsPlayed >= handsA + 3 && stateB.handsPlayed >= handsB + 3) {
      const gainA = stateA.pnlCents - pnlAAtBet;
      const gainB = stateB.pnlCents - pnlBAtBet;
      const aWins = gainA > gainB;
      const bWins = gainB > gainA;
      const isTie = gainA === gainB;
      let outcome: "win" | "loss" | "push";
      let payout_cents: number;
      if (isTie) {
        outcome = "push";
        payout_cents = Number(bet.amount_cents);
      } else {
        const win = (bet.direction === "a_wins" && aWins) || (bet.direction === "b_wins" && bWins);
        outcome = win ? "win" : "loss";
        if (win) {
          const poolRes = await query<{ direction: string; amount_cents: number }>(
            `SELECT direction, amount_cents FROM next_3_bets WHERE model_a_id = $1 AND model_b_id = $2 AND date = $3`,
            [bet.model_a_id, bet.model_b_id, betDate]
          );
          let totalA = 0;
          let totalB = 0;
          for (const row of poolRes.rows) {
            if (row.direction === "a_wins") totalA += Number(row.amount_cents);
            else totalB += Number(row.amount_cents);
          }
          const totalPool = totalA + totalB;
          const totalWinning = aWins ? totalA : totalB;
          const divisor = totalWinning > 0 ? totalWinning : 1;
          payout_cents = Math.round((Number(bet.amount_cents) * totalPool) / divisor);
        } else {
          payout_cents = 0;
        }
      }
      await query(`UPDATE next_3_bets SET outcome = $2, payout_cents = $3 WHERE id = $1`, [bet.id, outcome, payout_cents]);
      creditUserBalance(payout_cents);
    }
  }
  const list = await query<Next3Bet & { hands_a_at_bet: string; pnl_a_at_bet: string; hands_b_at_bet: string; pnl_b_at_bet: string; payout_cents?: number | null }>(
    `SELECT id, model_a_id, model_b_id, direction, amount_cents, outcome, payout_cents, hands_a_at_bet, pnl_a_at_bet, hands_b_at_bet, pnl_b_at_bet, date FROM next_3_bets`
  );
  return list.rows.map((r) => ({
    id: r.id,
    model_a_id: r.model_a_id,
    model_b_id: r.model_b_id,
    direction: r.direction,
    amount_cents: r.amount_cents,
    outcome: r.outcome,
    payout_cents: r.payout_cents != null ? Number(r.payout_cents) : null,
    hands_a_at_bet: Number(r.hands_a_at_bet),
    pnl_a_at_bet: Number(r.pnl_a_at_bet),
    hands_b_at_bet: Number(r.hands_b_at_bet),
    pnl_b_at_bet: Number(r.pnl_b_at_bet),
    date: r.date,
  }));
}

export type Next3OddsHistoryPoint = { time: string; impliedAWinsPct: number; totalACents: number; totalBCents: number };

/** Get implied probability (A wins %) over time for a Next 3 hands market (model A vs model B). */
export async function getNext3OddsHistory(
  modelAId: string,
  modelBId: string,
  period: string
): Promise<Next3OddsHistoryPoint[]> {
  const res = await query<{ direction: string; amount_cents: number; created_at: string }>(
    `SELECT direction, amount_cents, created_at FROM next_3_bets WHERE model_a_id = $1 AND model_b_id = $2 AND date = $3 ORDER BY created_at ASC`,
    [modelAId, modelBId, period]
  );
  const points: Next3OddsHistoryPoint[] = [];
  let totalA = 0;
  let totalB = 0;
  for (const row of res.rows) {
    if (row.direction === "a_wins") totalA += Number(row.amount_cents);
    else totalB += Number(row.amount_cents);
    const total = totalA + totalB;
    const impliedAWinsPct = total > 0 ? (100 * totalA) / total : 50;
    points.push({
      time: row.created_at ?? "",
      impliedAWinsPct: Math.round(impliedAWinsPct * 10) / 10,
      totalACents: totalA,
      totalBCents: totalB,
    });
  }
  return points;
}
