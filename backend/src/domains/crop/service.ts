import { getAIProvider } from "../../ai/index.js";
import { config } from "../../config.js";
import { fetchCornPrices, type CornPricePoint } from "../../data/corn.js";
import { settleCropNextTestBets } from "./market.js";

const CROP_BANKROLL_CENTS = config.cropBankrollCents;
const TEST_STEPS = 10; // number of trading steps in a ~30s run (each step: fetch price + AI call)
const MS_PER_STEP = 2800; // ~3s per step so total ~30s

export type CropTrade = "buy" | "sell" | "hold";
export type CropPortfolioSnapshot = {
  date: string;
  pricePerBushel: number;
  cashCents: number;
  bushels: number;
  valueCents: number;
  trade?: CropTrade;
  size?: number;
  reasoning?: string | null;
  /** Long-term prediction: US corn yield, bushels per acre (e.g. for the crop year). Updated each step. */
  longTermBushelsPerAcre?: number | null;
  reasonLongTerm?: string | null;
};
export type CropTestResult = {
  modelId: string;
  prices: CornPricePoint[];
  history: CropPortfolioSnapshot[];
  finalValueCents: number;
  startValueCents: number;
};

export type CropTestResultVs = {
  modelAId: string;
  modelBId: string;
  prices: CornPricePoint[];
  historyA: CropPortfolioSnapshot[];
  historyB: CropPortfolioSnapshot[];
  finalValueCentsA: number;
  finalValueCentsB: number;
  startValueCents: number;
};

function buildCropPrompt(
  date: string,
  pricePerBushel: number,
  cashCents: number,
  bushels: number
): string {
  const cashDollars = (cashCents / 100).toFixed(2);
  const valueCents = cashCents + Math.round(bushels * pricePerBushel * 100);
  const valueDollars = (valueCents / 100).toFixed(2);
  return `You are trading US corn futures with fake money. One contract is 5000 bushels; for this exercise you trade in bushels and dollars.

Current date: ${date}
Current corn price: $${pricePerBushel.toFixed(2)} per bushel.

Your portfolio:
- Cash: $${cashDollars}
- Corn: ${bushels.toFixed(0)} bushels (worth $${(bushels * pricePerBushel).toFixed(2)} at current price)
- Total value: $${valueDollars}

Reply with exactly two lines:
TRADE: buy|sell|hold
SIZE: <number>

For buy: SIZE = dollars to spend (we buy as many bushels as that buys at current price).
For sell: SIZE = bushels to sell.
For hold: SIZE = 0.

Then add:
REASONING: Write 2-4 sentences that connect this trade to your long-term view. You must include: (1) The current price is $X per bushel. (2) What that implies about the market's view of yield (e.g. "the market is pricing in roughly Y bu/acre" or "current price suggests the market expects ..."). (3) Your own long-term yield prediction (bushels per acre) for this crop year. (4) Since [your prediction] [does/doesn't] match [or is above/below] the market's implied view, I am [buying/selling/holding] because ... You can also mention position size or risk, but the main thing we want to see is the link between current price, implied market yield, your forecast, and your trade.

Also give your long-term prediction for US corn yield (bushels per acre) for the current crop year. You can update this each step as new information is implied by prices.
BUSHELS_PER_ACRE: <number>
REASON_LONGTERM: Write 2-4 sentences. Explain your reasoning for this yield forecast. State clearly whether you are using or referring to any external information—e.g. weather data, USDA reports, historical yields, or other factors—or that you are not using external data and are inferring only from the price series given.

Keep positions reasonable; do not exceed your cash when buying or your bushels when selling.`;
}

function parseCropResponse(text: string): {
  trade: CropTrade;
  size: number;
  reasoning: string | null;
  longTermBushelsPerAcre: number | null;
  reasonLongTerm: string | null;
} {
  const raw = (text ?? "").trim();
  const tradeMatch = raw.match(/TRADE:\s*(buy|sell|hold)/i);
  const sizeMatch = raw.match(/SIZE:\s*([\d.]+)/i);
  const reasoningMatch = raw.match(/REASONING:\s*([\s\S]+?)(?=BUSHELS_PER_ACRE:|REASON_LONGTERM:|$)/i);
  const buMatch = raw.match(/BUSHELS_PER_ACRE:\s*([\d.]+)/i);
  const reasonLongMatch = raw.match(/REASON_LONGTERM:\s*([\s\S]+)/i);
  const trade = (tradeMatch?.[1]?.toLowerCase() ?? "hold") as CropTrade;
  const size = Math.max(0, parseFloat(sizeMatch?.[1] ?? "0") || 0);
  const reasoning = reasoningMatch?.[1]?.trim() ?? null;
  const longTermBushelsPerAcre = buMatch?.[1] != null ? parseFloat(buMatch[1]) : null;
  const reasonLongTerm = reasonLongMatch?.[1]?.trim() ?? null;
  return {
    trade,
    size,
    reasoning,
    longTermBushelsPerAcre: Number.isFinite(longTermBushelsPerAcre) ? longTermBushelsPerAcre : null,
    reasonLongTerm,
  };
}

/** Run a single test: fetch real corn data, then over ~30s run TEST_STEPS steps; at each step ask AI and apply trade. */
export async function runCropTest(modelId: string): Promise<CropTestResult> {
  const provider = getAIProvider(modelId);
  if (!provider) throw new Error(`Unknown AI model: ${modelId}`);

  const prices = await fetchCornPrices();
  if (prices.length < TEST_STEPS) throw new Error("Not enough corn price data");

  const history: CropPortfolioSnapshot[] = [];
  let cashCents = CROP_BANKROLL_CENTS;
  let bushels = 0;

  // Use up to TEST_STEPS data points (e.g. last 10 days), spread across the series
  let stepIndices: number[] =
    prices.length >= TEST_STEPS
      ? Array.from({ length: TEST_STEPS }, (_: unknown, i: number) => Math.min(Math.floor((prices.length * (i + 1)) / (TEST_STEPS + 1)), prices.length - 1))
      : prices.map((_: CornPricePoint, i: number) => i);
  if (stepIndices.length === 0) stepIndices = [0];

  for (let i = 0; i < stepIndices.length; i++) {
    const idx = stepIndices[i];
    const point = prices[idx];
    const date = point.date;
    const pricePerBushel = point.pricePerBushel;
    const priceCentsPerBushel = Math.round(pricePerBushel * 100);

    const prompt = buildCropPrompt(date, pricePerBushel, cashCents, bushels);
    const response = await provider.ask(prompt);
    const textToParse = response.raw ?? [response.decision, response.reasoning].filter(Boolean).join(" ");
    const { trade, size, reasoning, longTermBushelsPerAcre, reasonLongTerm } = parseCropResponse(textToParse);

    if (trade === "buy" && size > 0) {
      const spendCents = Math.min(cashCents, Math.round(size * 100)); // size in dollars
      if (priceCentsPerBushel > 0 && spendCents > 0) {
        const buyBushels = Math.floor(spendCents / priceCentsPerBushel);
        cashCents -= buyBushels * priceCentsPerBushel;
        bushels += buyBushels;
      }
    } else if (trade === "sell" && size > 0) {
      const sellBushels = Math.min(bushels, Math.floor(size));
      cashCents += sellBushels * priceCentsPerBushel;
      bushels -= sellBushels;
    }

    const valueCents = cashCents + bushels * priceCentsPerBushel;
    history.push({
      date,
      pricePerBushel,
      cashCents,
      bushels,
      valueCents,
      trade,
      size,
      reasoning,
      longTermBushelsPerAcre: longTermBushelsPerAcre ?? undefined,
      reasonLongTerm: reasonLongTerm ?? undefined,
    });

    // Throttle so total run is ~30s
    if (i < stepIndices.length - 1) {
      await new Promise((r) => setTimeout(r, MS_PER_STEP));
    }
  }

  const last = history[history.length - 1];
  return {
    modelId,
    prices,
    history,
    startValueCents: CROP_BANKROLL_CENTS,
    finalValueCents: last?.valueCents ?? CROP_BANKROLL_CENTS,
  };
}

/** Run crop test with two models on the same price series; both compete with separate $100k portfolios. */
export async function runCropTestVs(modelIdA: string, modelIdB: string): Promise<CropTestResultVs> {
  const providerA = getAIProvider(modelIdA);
  const providerB = getAIProvider(modelIdB);
  if (!providerA) throw new Error(`Unknown AI model: ${modelIdA}`);
  if (!providerB) throw new Error(`Unknown AI model: ${modelIdB}`);
  if (modelIdA === modelIdB) throw new Error("Choose two different models");

  const prices = await fetchCornPrices();
  if (prices.length < TEST_STEPS) throw new Error("Not enough corn price data");

  const historyA: CropPortfolioSnapshot[] = [];
  const historyB: CropPortfolioSnapshot[] = [];
  let cashA = CROP_BANKROLL_CENTS;
  let bushelsA = 0;
  let cashB = CROP_BANKROLL_CENTS;
  let bushelsB = 0;

  let stepIndices: number[] =
    prices.length >= TEST_STEPS
      ? Array.from({ length: TEST_STEPS }, (_: unknown, i: number) => Math.min(Math.floor((prices.length * (i + 1)) / (TEST_STEPS + 1)), prices.length - 1))
      : prices.map((_: CornPricePoint, i: number) => i);
  if (stepIndices.length === 0) stepIndices = [0];

  for (let i = 0; i < stepIndices.length; i++) {
    const idx = stepIndices[i];
    const point = prices[idx];
    const date = point.date;
    const pricePerBushel = point.pricePerBushel;
    const priceCentsPerBushel = Math.round(pricePerBushel * 100);

    const promptA = buildCropPrompt(date, pricePerBushel, cashA, bushelsA);
    const promptB = buildCropPrompt(date, pricePerBushel, cashB, bushelsB);
    const [responseA, responseB] = await Promise.all([
      providerA.ask(promptA),
      providerB.ask(promptB),
    ]);
    const textA = responseA.raw ?? [responseA.decision, responseA.reasoning].filter(Boolean).join(" ");
    const textB = responseB.raw ?? [responseB.decision, responseB.reasoning].filter(Boolean).join(" ");
    const parsedA = parseCropResponse(textA);
    const parsedB = parseCropResponse(textB);

    if (parsedA.trade === "buy" && parsedA.size > 0) {
      const spendCents = Math.min(cashA, Math.round(parsedA.size * 100));
      if (priceCentsPerBushel > 0 && spendCents > 0) {
        const buyBushels = Math.floor(spendCents / priceCentsPerBushel);
        cashA -= buyBushels * priceCentsPerBushel;
        bushelsA += buyBushels;
      }
    } else if (parsedA.trade === "sell" && parsedA.size > 0) {
      const sellBushels = Math.min(bushelsA, Math.floor(parsedA.size));
      cashA += sellBushels * priceCentsPerBushel;
      bushelsA -= sellBushels;
    }
    if (parsedB.trade === "buy" && parsedB.size > 0) {
      const spendCents = Math.min(cashB, Math.round(parsedB.size * 100));
      if (priceCentsPerBushel > 0 && spendCents > 0) {
        const buyBushels = Math.floor(spendCents / priceCentsPerBushel);
        cashB -= buyBushels * priceCentsPerBushel;
        bushelsB += buyBushels;
      }
    } else if (parsedB.trade === "sell" && parsedB.size > 0) {
      const sellBushels = Math.min(bushelsB, Math.floor(parsedB.size));
      cashB += sellBushels * priceCentsPerBushel;
      bushelsB -= sellBushels;
    }

    const valueA = cashA + bushelsA * priceCentsPerBushel;
    const valueB = cashB + bushelsB * priceCentsPerBushel;
    historyA.push({
      date,
      pricePerBushel,
      cashCents: cashA,
      bushels: bushelsA,
      valueCents: valueA,
      trade: parsedA.trade,
      size: parsedA.size,
      reasoning: parsedA.reasoning,
      longTermBushelsPerAcre: parsedA.longTermBushelsPerAcre ?? undefined,
      reasonLongTerm: parsedA.reasonLongTerm ?? undefined,
    });
    historyB.push({
      date,
      pricePerBushel,
      cashCents: cashB,
      bushels: bushelsB,
      valueCents: valueB,
      trade: parsedB.trade,
      size: parsedB.size,
      reasoning: parsedB.reasoning,
      longTermBushelsPerAcre: parsedB.longTermBushelsPerAcre ?? undefined,
      reasonLongTerm: parsedB.reasonLongTerm ?? undefined,
    });

    if (i < stepIndices.length - 1) {
      await new Promise((r) => setTimeout(r, MS_PER_STEP));
    }
  }

  const lastA = historyA[historyA.length - 1];
  const lastB = historyB[historyB.length - 1];
  const finalValueCentsA = lastA?.valueCents ?? CROP_BANKROLL_CENTS;
  const finalValueCentsB = lastB?.valueCents ?? CROP_BANKROLL_CENTS;
  settleCropNextTestBets(modelIdA, modelIdB, finalValueCentsA, finalValueCentsB);

  return {
    modelAId: modelIdA,
    modelBId: modelIdB,
    prices,
    historyA,
    historyB,
    startValueCents: CROP_BANKROLL_CENTS,
    finalValueCentsA,
    finalValueCentsB,
  };
}
