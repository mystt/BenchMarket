#!/usr/bin/env npx tsx
/**
 * Verification script for crop cost basis and P/L logic.
 * Run: npx tsx backend/scripts/verify-crop-pnl.ts
 *
 * Uses user's example: buys at 439.75¢, 439.75¢, 439.25¢ → verify avg cost and P/L.
 */

// Simulate a buy: same logic as runCropSingleStepVs
function applyBuy(
  spendCents: number,
  pricePerBushel: number,
  cash: number,
  bushels: number,
  costBasis: number,
  useExactPrice: boolean
): { cash: number; bushels: number; costBasis: number } {
  const priceCentsPerBushel = Math.round(pricePerBushel * 100);
  const spend = Math.min(cash, spendCents);
  const buyBushels = Math.floor(spend / priceCentsPerBushel);
  const cashOut = buyBushels * priceCentsPerBushel;
  const costBasisAdd = useExactPrice
    ? Math.round(buyBushels * pricePerBushel * 100)
    : buyBushels * priceCentsPerBushel;
  return {
    cash: cash - cashOut,
    bushels: bushels + buyBushels,
    costBasis: costBasis + costBasisAdd,
  };
}

function computePnl(
  bushels: number,
  costBasisCents: number,
  currentPricePerBushel: number,
  useExactPrice: boolean
): number {
  const avgCostCentsPerBushel = costBasisCents / bushels;
  const priceCents = useExactPrice ? currentPricePerBushel * 100 : Math.round(currentPricePerBushel * 100);
  return Math.round(bushels * (priceCents - avgCostCentsPerBushel));
}

console.log("=== Crop P/L verification ===\n");

// User's example: 3 buys
const BANKROLL = 100_000_00; // $100k in cents
const buys = [
  { spendCents: 50_000_00, priceCentsPerBu: 439.75 },   // $50k at 439.75¢
  { spendCents: 5_000_00, priceCentsPerBu: 439.75 },    // $5k at 439.75¢
  { spendCents: 45_004_00, priceCentsPerBu: 439.25 },   // $45,004 at 439.25¢
];

let stateOld = { cash: BANKROLL, bushels: 0, costBasis: 0 };
let stateNew = { cash: BANKROLL, bushels: 0, costBasis: 0 };

for (const b of buys) {
  const pricePerBushel = b.priceCentsPerBu / 100;
  stateOld = applyBuy(b.spendCents, pricePerBushel, stateOld.cash, stateOld.bushels, stateOld.costBasis, false);
  stateNew = applyBuy(b.spendCents, pricePerBushel, stateNew.cash, stateNew.bushels, stateNew.costBasis, true);
}

console.log("Buys:", buys.map((b) => `$${(b.spendCents / 100).toLocaleString()} @ ${b.priceCentsPerBu}¢/bu`).join(", "));
console.log("\nResults:");
console.log("  Bushels:", stateNew.bushels);

const avgCostOld = stateOld.costBasis / stateOld.bushels;
const avgCostNew = stateNew.costBasis / stateNew.bushels;
console.log("  Avg cost (OLD formula, rounded):", avgCostOld.toFixed(2), "¢/bu");
console.log("  Avg cost (NEW formula, exact):   ", avgCostNew.toFixed(2), "¢/bu");

// When current price = 439.25¢
const currentPrice = 439.25 / 100;
const pnlOld = computePnl(stateOld.bushels, stateOld.costBasis, currentPrice, false);
const pnlNew = computePnl(stateNew.bushels, stateNew.costBasis, currentPrice, true);
console.log("\nAt current price 439.25¢/bu:");
console.log("  P/L (OLD - rounded price):", (pnlOld / 100).toFixed(2), "$");
console.log("  P/L (NEW - exact price):   ", (pnlNew / 100).toFixed(2), "$");

// Critical check: when avg cost === current price exactly, P/L must be 0
const exactAvgCost = stateNew.costBasis / stateNew.bushels; // 439.xxx
const priceWhenBreakEven = exactAvgCost / 100; // back to $/bu for the function
const pnlBreakEven = computePnl(stateNew.bushels, stateNew.costBasis, priceWhenBreakEven, true);
console.log("\n--- Critical: P/L when current price = avg cost ---");
console.log("  Avg cost:", exactAvgCost.toFixed(4), "¢/bu");
console.log("  P/L when price = avg cost (must be 0):", pnlBreakEven, "cents");
if (pnlBreakEven === 0) {
  console.log("  ✓ PASS: P/L is $0 when price equals avg cost");
} else {
  console.log("  ✗ FAIL: P/L should be 0, got", pnlBreakEven);
}

// Also verify: if we had bought ALL at same price, avg cost = that price, P/L at same price = 0
console.log("\n--- Sanity: all buys at same price ---");
const singlePrice = 4.3975; // $/bu
let s = { cash: BANKROLL, bushels: 0, costBasis: 0 };
s = applyBuy(100_000_00, singlePrice, s.cash, s.bushels, s.costBasis, true);
const avgSingle = s.costBasis / s.bushels;
const pnlSamePrice = computePnl(s.bushels, s.costBasis, singlePrice, true);
console.log("  Bought all at 439.75¢, avg cost:", avgSingle.toFixed(2), "¢/bu, P/L at 439.75¢:", pnlSamePrice, "cents");
if (pnlSamePrice === 0) {
  console.log("  ✓ PASS");
} else {
  console.log("  ✗ FAIL");
}

console.log("\n=== Done ===");
