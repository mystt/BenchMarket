/**
 * Auto-play: one VS hand (two AIs at the same table) every AUTO_PLAY_DELAY_MS.
 * When it's time, we set a "pending" hand so the frontend can claim it and stream
 * the hand in the UI. If no one claims within CLAIM_MS, we run the hand with noop.
 */
import { config } from "../config.js";
import { getAIProviders } from "../ai/index.js";
import { playHandsStreamVs } from "../domains/blackjack/service.js";

const CLAIM_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Milliseconds until next UTC midnight. */
function msUntilNextDay(): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime() - now.getTime();
}

export type AutoPlayStatus = {
  enabled: boolean;
  nextHandAt: string | null;
  lastHandAt: string | null;
  intervalMs: number;
  modelAId: string | null;
  modelBId: string | null;
};

let autoPlayState: {
  nextHandAt: Date | null;
  lastHandAt: Date | null;
  modelAId: string | null;
  modelBId: string | null;
  pendingHand: { modelAId: string; modelBId: string; at: number } | null;
} = { nextHandAt: null, lastHandAt: null, modelAId: null, modelBId: null, pendingHand: null };

export function getAutoPlayStatus(): AutoPlayStatus {
  const delayMs = config.autoPlayDelayMs;
  return {
    enabled: delayMs > 0,
    nextHandAt: autoPlayState.nextHandAt ? autoPlayState.nextHandAt.toISOString() : null,
    lastHandAt: autoPlayState.lastHandAt ? autoPlayState.lastHandAt.toISOString() : null,
    intervalMs: delayMs,
    modelAId: autoPlayState.modelAId,
    modelBId: autoPlayState.modelBId,
  };
}

/** If the given models match the pending hand, clear it and return true (caller will run the hand and stream). */
export function claimPendingHand(modelAId: string, modelBId: string): boolean {
  const p = autoPlayState.pendingHand;
  if (!p) return false;
  const match = (p.modelAId === modelAId && p.modelBId === modelBId) || (p.modelAId === modelBId && p.modelBId === modelAId);
  if (match) {
    autoPlayState.pendingHand = null;
    return true;
  }
  return false;
}

export function setAutoPlayLastHandAt(): void {
  autoPlayState.lastHandAt = new Date();
}

async function runVsLoop(): Promise<void> {
  const delayMs = config.autoPlayDelayMs;
  const tickMs = 1_000;
  const providers = getAIProviders();
  if (providers.length < 2) return;

  const modelAId = providers[0].id;
  const modelBId = providers[1].id;
  const nameA = providers[0].name;
  const nameB = providers[1].name;
  autoPlayState.modelAId = modelAId;
  autoPlayState.modelBId = modelBId;

  const maxBet = config.blackjackMaxBetCents;
  const noop = () => {};

  let handCount = 0;
  while (true) {
    const now = Date.now();
    if (autoPlayState.pendingHand) {
      const age = now - autoPlayState.pendingHand.at;
      if (age >= CLAIM_MS) {
        try {
          await playHandsStreamVs(modelAId, modelBId, maxBet, 1, noop);
          handCount++;
          autoPlayState.lastHandAt = new Date();
          if (handCount % 10 === 0) {
            console.log(`Auto-play VS (${nameA} vs ${nameB}): ${handCount} hands (unclaimed)`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("Insufficient bankroll")) {
            const waitMs = msUntilNextDay();
            console.log(`Auto-play VS: out of bankroll after ${handCount} hands; sleeping until next UTC day (${(waitMs / 1000 / 60).toFixed(0)} min)`);
            autoPlayState.nextHandAt = new Date(Date.now() + waitMs);
            autoPlayState.pendingHand = null;
            await sleep(waitMs);
            handCount = 0;
            continue;
          }
          console.warn("Auto-play VS hand failed (unclaimed):", msg);
        }
        autoPlayState.pendingHand = null;
      }
    }
    if (!autoPlayState.pendingHand && (!autoPlayState.nextHandAt || now >= autoPlayState.nextHandAt.getTime() - 1000)) {
      autoPlayState.pendingHand = { modelAId, modelBId, at: now };
      autoPlayState.nextHandAt = new Date(now + delayMs);
    }
    await sleep(tickMs);
  }
}

export function startAutoPlayBlackjack(): void {
  if (config.autoPlayDelayMs <= 0) return;

  const providers = getAIProviders();
  if (providers.length < 2) {
    console.log("Auto-play blackjack: need at least 2 models for VS; skipping.");
    return;
  }

  const delayMs = config.autoPlayDelayMs;
  const nameA = providers[0].name;
  const nameB = providers[1].name;
  console.log(`Auto-play blackjack: one VS hand (${nameA} vs ${nameB}) every ${(delayMs / 1000 / 60).toFixed(1)} min. Place bets between hands.`);

  runVsLoop();
}
