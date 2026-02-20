/**
 * Runs blackjack continuously: hand after hand, with a short delay between hands.
 * When AUTO_PLAY_DELAY_MS > 0, each AI model runs its own loop playing hands until it runs out of bankroll.
 */
import { config } from "../config.js";
import { getAIProviders } from "../ai/index.js";
import { playHand } from "../domains/blackjack/service.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runModelLoop(modelId: string, modelName: string, betCents: number, delayMs: number): Promise<void> {
  let handCount = 0;
  while (true) {
    try {
      await playHand(modelId, betCents);
      handCount++;
      if (handCount % 10 === 0) {
        console.log(`Auto-play ${modelName}: ${handCount} hands played`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Insufficient bankroll")) {
        console.log(`Auto-play ${modelName}: stopped (out of bankroll after ${handCount} hands)`);
        break;
      }
      console.warn(`Auto-play ${modelName} hand failed:`, msg);
    }
    await sleep(delayMs);
  }
}

export function startAutoPlayBlackjack(): void {
  if (config.autoPlayDelayMs <= 0) return;

  const betCents = config.autoPlayBetCents;
  const delayMs = config.autoPlayDelayMs;
  const providers = getAIProviders();
  if (providers.length === 0) return;

  console.log(`Auto-play blackjack: continuous (hand after hand), ${delayMs / 1000}s between hands, $${(betCents / 100).toFixed(2)}/hand. Models: ${providers.map((p) => p.name).join(", ")}`);

  for (const p of providers) {
    runModelLoop(p.id, p.name, betCents, delayMs);
  }
}
