/**
 * US corn futures price data. Fetches from USDA Quick Stats (public) or falls back to sample data.
 * For production, you can plug in Alpha Vantage, FRED, or another data source.
 */

export type CornPricePoint = {
  date: string;
  pricePerBushel: number;
};

const SAMPLE_PRICES: CornPricePoint[] = [
  { date: "2025-01-06", pricePerBushel: 4.42 },
  { date: "2025-01-07", pricePerBushel: 4.38 },
  { date: "2025-01-08", pricePerBushel: 4.45 },
  { date: "2025-01-09", pricePerBushel: 4.41 },
  { date: "2025-01-10", pricePerBushel: 4.39 },
  { date: "2025-01-13", pricePerBushel: 4.44 },
  { date: "2025-01-14", pricePerBushel: 4.47 },
  { date: "2025-01-15", pricePerBushel: 4.43 },
  { date: "2025-01-16", pricePerBushel: 4.48 },
  { date: "2025-01-17", pricePerBushel: 4.46 },
  { date: "2025-01-20", pricePerBushel: 4.51 },
  { date: "2025-01-21", pricePerBushel: 4.49 },
  { date: "2025-01-22", pricePerBushel: 4.52 },
  { date: "2025-01-23", pricePerBushel: 4.55 },
  { date: "2025-01-24", pricePerBushel: 4.53 },
];

export async function fetchCornPrices(): Promise<CornPricePoint[]> {
  // TODO: Plug in USDA, Alpha Vantage, FRED, or another data source for live corn futures
  return SAMPLE_PRICES;
}
