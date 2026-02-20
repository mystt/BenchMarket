/**
 * In-memory user balance for betting. Single user (no auth).
 * $1000 per day (claim once per day), watch-ad placeholder $100.
 * Deduct when placing bets; credit when bets settle (win/push).
 */

const DAILY_CENTS = 100_000; // $1000
const WATCH_AD_CENTS = 10_000; // $100

let balanceCents = 0;
let lastDailyDate = "";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getBalance(): { balanceCents: number; dailyClaimedToday: boolean } {
  return {
    balanceCents,
    dailyClaimedToday: lastDailyDate === today(),
  };
}

/** Claim $1000 daily. Returns new balance or throws if already claimed today. */
export function claimDaily(): number {
  const t = today();
  if (lastDailyDate === t) {
    throw new Error("Daily bonus already claimed today");
  }
  lastDailyDate = t;
  balanceCents += DAILY_CENTS;
  return balanceCents;
}

/** Watch ad (placeholder): credit $100. */
export function creditWatchAd(): number {
  balanceCents += WATCH_AD_CENTS;
  return balanceCents;
}

/** Deduct for a bet. Returns true if successful, false if insufficient balance. */
export function deduct(amountCents: number): boolean {
  if (amountCents <= 0) return true;
  if (balanceCents < amountCents) return false;
  balanceCents -= amountCents;
  return true;
}

/** Credit user when a bet settles (win or push payout). */
export function credit(amountCents: number): void {
  if (amountCents > 0) balanceCents += amountCents;
}
