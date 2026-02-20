/**
 * In-memory store when no DB is installed (no Python / native modules needed).
 * Data resets when the server restarts.
 */

export type QueryResult<T = Record<string, unknown>> = { rows: T[]; rowCount: number };

const aiModels: Record<string, { id: string; name: string; provider: string }> = {};
const dailyBankrolls: Map<string, { balance_cents: number }> = new Map();
const blackjackHands: { model_id: string; date: string; pnl_cents: number }[] = [];
const performanceBets: { id: string; domain: string; model_id: string; period: string; direction: string; amount_cents: number; outcome: string; payout_cents: number; created_at: string }[] = [];
const next3Bets: { id: string; model_a_id: string; model_b_id: string; direction: string; amount_cents: number; outcome: string; payout_cents: number; hands_a_at_bet: number; pnl_a_at_bet: number; hands_b_at_bet: number; pnl_b_at_bet: number; date: string; created_at: string }[] = [];

function key(modelId: string, domain: string, date: string) {
  return `${modelId}|${domain}|${date}`;
}

export function memoryQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): QueryResult<T> {
  const sql = text.replace(/\$(\d+)/g, (_, n) => String(params[Number(n) - 1]));
  const p = (i: number) => params[i - 1] as string | number;

  // INSERT ai_models ON CONFLICT DO NOTHING
  if (text.includes("INSERT INTO ai_models") && text.includes("ON CONFLICT")) {
    if (!aiModels[p(1) as string]) {
      aiModels[p(1) as string] = { id: p(1) as string, name: p(2) as string, provider: p(3) as string };
    }
    return { rows: [], rowCount: 0 };
  }

  // INSERT daily_bankrolls ... ON CONFLICT DO UPDATE ... RETURNING balance_cents
  if (text.includes("INSERT INTO daily_bankrolls") && text.includes("RETURNING balance_cents")) {
    const k = key(p(2) as string, p(3) as string, p(4) as string);
    const existing = dailyBankrolls.get(k);
    const balance = existing ? existing.balance_cents : (p(5) as number);
    if (!existing) dailyBankrolls.set(k, { balance_cents: balance });
    return { rows: [{ balance_cents: balance } as T], rowCount: 1 };
  }

  // UPDATE daily_bankrolls SET balance_cents = balance_cents - $3 ... RETURNING balance_cents
  if (text.includes("UPDATE daily_bankrolls") && text.includes("balance_cents - ") && text.includes("RETURNING")) {
    const k = key(p(1) as string, "blackjack", p(2) as string);
    const row = dailyBankrolls.get(k);
    if (!row || row.balance_cents < (p(3) as number)) return { rows: [], rowCount: 0 };
    row.balance_cents -= p(3) as number;
    return { rows: [{ balance_cents: row.balance_cents } as T], rowCount: 1 };
  }

  // UPDATE daily_bankrolls SET balance_cents = balance_cents + $3
  if (text.includes("UPDATE daily_bankrolls") && text.includes("balance_cents + ")) {
    const k = key(p(1) as string, "blackjack", p(2) as string);
    const row = dailyBankrolls.get(k);
    if (row) row.balance_cents += p(3) as number;
    return { rows: [], rowCount: 0 };
  }

  // SELECT balance_cents FROM daily_bankrolls
  if (text.includes("SELECT balance_cents FROM daily_bankrolls")) {
    const k = key(p(1) as string, "blackjack", p(2) as string);
    const row = dailyBankrolls.get(k);
    return { rows: (row ? [row] : []) as T[], rowCount: row ? 1 : 0 };
  }

  // INSERT INTO blackjack_hands
  if (text.includes("INSERT INTO blackjack_hands")) {
    blackjackHands.push({
      model_id: p(2) as string,
      date: p(3) as string,
      pnl_cents: p(10) as number,
    });
    return { rows: [], rowCount: 0 };
  }

  // SELECT COUNT(*), COALESCE(SUM(pnl_cents), 0) FROM blackjack_hands
  if (text.includes("FROM blackjack_hands") && text.includes("COUNT(*)")) {
    const list = blackjackHands.filter((h) => h.model_id === p(1) && h.date === p(2));
    const count = list.length;
    const pnl = list.reduce((s, h) => s + h.pnl_cents, 0);
    return {
      rows: [{ count: String(count), pnl: String(pnl) } as T],
      rowCount: 1,
    };
  }

  // SELECT model_id, pnl_cents FROM blackjack_hands WHERE date = $1 (chronological order for history)
  if (text.includes("FROM blackjack_hands") && text.includes("model_id") && text.includes("pnl_cents") && text.includes("date = $1")) {
    const date = p(1) as string;
    const rows = blackjackHands.filter((h) => h.date === date).map((h) => ({ model_id: h.model_id, pnl_cents: h.pnl_cents })) as T[];
    return { rows, rowCount: rows.length };
  }

  // INSERT INTO performance_bets (with created_at)
  if (text.includes("INSERT INTO performance_bets")) {
    const id = String(p(1));
    const created_at = params[6] != null ? String(params[6]) : new Date().toISOString();
    performanceBets.push({
      id,
      domain: p(2) as string,
      model_id: p(3) as string,
      period: p(4) as string,
      direction: p(5) as string,
      amount_cents: p(6) as number,
      outcome: "pending",
      payout_cents: 0,
      created_at,
    });
    return { rows: [{ id } as T], rowCount: 1 };
  }

  // SELECT * FROM performance_bets [WHERE ...] [ORDER BY created_at]
  if (text.includes("FROM performance_bets") && text.includes("SELECT")) {
    let list = performanceBets;
    if (text.includes("WHERE")) {
      if (text.includes("domain = $1") && text.includes("model_id = $2") && text.includes("period = $3")) {
        list = performanceBets.filter((b) => b.domain === p(1) && b.model_id === p(2) && b.period === p(3));
      } else if (text.includes("outcome = 'pending'") && text.includes("domain = $1") && text.includes("period = $2")) {
        list = performanceBets.filter((b) => b.outcome === "pending" && b.domain === p(1) && b.period === p(2));
      }
    }
    if (text.includes("ORDER BY created_at")) {
      list = [...list].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    }
    const rows = list.map((b) => ({
      id: b.id,
      domain: b.domain,
      model_id: b.model_id,
      period: b.period,
      direction: b.direction,
      amount_cents: b.amount_cents,
      outcome: b.outcome,
      payout_cents: b.payout_cents ?? 0,
      created_at: b.created_at ?? "",
    })) as T[];
    return { rows, rowCount: rows.length };
  }

  // UPDATE performance_bets SET outcome = $2, payout_cents = $3 WHERE id = $1
  if (text.includes("UPDATE performance_bets") && text.includes("outcome")) {
    const id = p(1) as string;
    const outcome = p(2) as string;
    const payout_cents = params[2] != null ? Number(params[2]) : 0;
    const b = performanceBets.find((x) => x.id === id);
    if (b) {
      b.outcome = outcome;
      b.payout_cents = payout_cents;
    }
    return { rows: [], rowCount: 0 };
  }

  // INSERT INTO next_3_bets (with created_at)
  if (text.includes("INSERT INTO next_3_bets")) {
    const created_at = params.length >= 11 && params[10] != null ? String(params[10]) : new Date().toISOString();
    next3Bets.push({
      id: p(1) as string,
      model_a_id: p(2) as string,
      model_b_id: p(3) as string,
      direction: p(4) as string,
      amount_cents: p(5) as number,
      outcome: "pending",
      payout_cents: 0,
      hands_a_at_bet: p(6) as number,
      pnl_a_at_bet: p(7) as number,
      hands_b_at_bet: p(8) as number,
      pnl_b_at_bet: p(9) as number,
      date: p(10) as string,
      created_at,
    });
    return { rows: [{ id: p(1) } as T], rowCount: 1 };
  }

  // SELECT FROM next_3_bets [WHERE model_a_id, model_b_id, date] [ORDER BY created_at]
  if (text.includes("FROM next_3_bets") && text.includes("SELECT")) {
    let list = next3Bets;
    if (text.includes("WHERE") && text.includes("model_a_id = $1") && text.includes("model_b_id = $2") && text.includes("date = $3")) {
      list = next3Bets.filter((b) => b.model_a_id === p(1) && b.model_b_id === p(2) && b.date === p(3));
    }
    if (text.includes("ORDER BY created_at")) {
      list = [...list].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
    }
    const rows = list.map((b) => ({
      id: b.id,
      model_a_id: b.model_a_id,
      model_b_id: b.model_b_id,
      direction: b.direction,
      amount_cents: b.amount_cents,
      outcome: b.outcome,
      payout_cents: b.payout_cents ?? 0,
      hands_a_at_bet: b.hands_a_at_bet,
      pnl_a_at_bet: b.pnl_a_at_bet,
      hands_b_at_bet: b.hands_b_at_bet,
      pnl_b_at_bet: b.pnl_b_at_bet,
      date: b.date,
      created_at: b.created_at ?? "",
    })) as T[];
    return { rows, rowCount: rows.length };
  }

  // UPDATE next_3_bets SET outcome = $2, payout_cents = $3 WHERE id = $1
  if (text.includes("UPDATE next_3_bets") && text.includes("outcome")) {
    const id = p(1) as string;
    const outcome = p(2) as string;
    const payout_cents = params[2] != null ? Number(params[2]) : 0;
    const b = next3Bets.find((x) => x.id === id);
    if (b) {
      b.outcome = outcome;
      b.payout_cents = payout_cents;
    }
    return { rows: [], rowCount: 0 };
  }

  return { rows: [], rowCount: 0 };
}
