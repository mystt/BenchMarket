/**
 * Auto-play: one crop VS test (two AIs, same price data) every CROP_AUTO_PLAY_DELAY_MS.
 * Runs runCropTestVs in the background and stores the last result for the frontend.
 */
import { config } from "../config.js";
import { getAIProviders } from "../ai/index.js";
import { runCropTestVs } from "../domains/crop/service.js";
import type { CropTestResultVs } from "../domains/crop/service.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CropAutoPlayStatus = {
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  intervalMs: number;
  modelAId: string | null;
  modelBId: string | null;
  lastResult: CropTestResultVs | null;
  lastError: string | null;
  running: boolean;
};

let cropAutoPlayState: {
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  modelAId: string | null;
  modelBId: string | null;
  lastResult: CropTestResultVs | null;
  lastError: string | null;
  running: boolean;
} = { nextRunAt: null, lastRunAt: null, modelAId: null, modelBId: null, lastResult: null, lastError: null, running: false };

export function getCropAutoPlayStatus(): CropAutoPlayStatus {
  const delayMs = config.cropAutoPlayDelayMs;
  return {
    enabled: delayMs > 0,
    nextRunAt: cropAutoPlayState.nextRunAt ? cropAutoPlayState.nextRunAt.toISOString() : null,
    lastRunAt: cropAutoPlayState.lastRunAt ? cropAutoPlayState.lastRunAt.toISOString() : null,
    intervalMs: delayMs,
    modelAId: cropAutoPlayState.modelAId,
    modelBId: cropAutoPlayState.modelBId,
    lastResult: cropAutoPlayState.lastResult,
    lastError: cropAutoPlayState.lastError,
    running: cropAutoPlayState.running,
  };
}

async function runCropLoop(): Promise<void> {
  const delayMs = config.cropAutoPlayDelayMs;
  const providers = getAIProviders();
  if (providers.length < 2) return;

  const modelAId = providers[0].id;
  const modelBId = providers[1].id;
  const nameA = providers[0].name;
  const nameB = providers[1].name;
  cropAutoPlayState.modelAId = modelAId;
  cropAutoPlayState.modelBId = modelBId;

  let runCount = 0;
  while (true) {
    const now = Date.now();
    const nextAt = cropAutoPlayState.nextRunAt?.getTime() ?? 0;
    const shouldRun = !cropAutoPlayState.running && (nextAt === 0 || now >= nextAt - 1000);

    if (shouldRun) {
      cropAutoPlayState.running = true;
      cropAutoPlayState.lastError = null;
      cropAutoPlayState.nextRunAt = new Date(now + delayMs);
      try {
        const result = await runCropTestVs(modelAId, modelBId);
        cropAutoPlayState.lastResult = result;
        cropAutoPlayState.lastRunAt = new Date();
        cropAutoPlayState.lastError = null;
        runCount++;
        if (runCount % 5 === 0) {
          console.log(`Auto-play crop (${nameA} vs ${nameB}): ${runCount} runs completed`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cropAutoPlayState.lastError = msg;
        console.warn("Auto-play crop run failed:", msg);
      }
      cropAutoPlayState.running = false;
    }

    await sleep(5000); // check every 5s
  }
}

export function startAutoPlayCrop(): void {
  if (config.cropAutoPlayDelayMs <= 0) return;

  const providers = getAIProviders();
  if (providers.length < 2) {
    console.log("Auto-play crop: need at least 2 models; skipping.");
    return;
  }

  const delayMs = config.cropAutoPlayDelayMs;
  const nameA = providers[0].name;
  const nameB = providers[1].name;
  console.log(
    `Auto-play crop: one VS test (${nameA} vs ${nameB}) every ${(delayMs / 1000 / 60).toFixed(1)} min. Place bets between runs.`
  );

  runCropLoop();
}
