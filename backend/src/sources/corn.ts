/**
 * US corn futures price data from Yahoo Finance (ZC=F). No fake data — errors if fetch fails.
 * CME corn is quoted in cents per bushel; we convert to dollars for display and calculations.
 */

import YahooFinance from "yahoo-finance2";

export type CornPricePoint = {
  date: string;
  pricePerBushel: number;
};

const CORN_SYMBOL = "ZC=F";
const DAYS_BACK = 60;
const MIN_POINTS = 10;

export async function fetchCornPrices(): Promise<CornPricePoint[]> {
  const yahooFinance = new YahooFinance();
  const period1 = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const period2 = new Date().toISOString().slice(0, 10);
  const raw = await yahooFinance.historical(CORN_SYMBOL, { period1, period2 });
  if (!Array.isArray(raw) || raw.length < MIN_POINTS) {
    throw new Error(
      `Corn futures: insufficient data from Yahoo Finance (got ${raw?.length ?? 0}, need ${MIN_POINTS}+). Check connectivity and ZC=F availability.`
    );
  }
  const points: CornPricePoint[] = raw
    .filter((row: { date?: Date; close?: number }) => row?.date && typeof row?.close === "number")
    .map((row: { date: Date; close: number }) => ({
      date: row.date.toISOString().slice(0, 10),
      pricePerBushel: row.close / 100, // CME corn close is in cents/bu; convert to $/bu
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < MIN_POINTS) {
    throw new Error(
      `Corn futures: valid data points insufficient (got ${points.length}, need ${MIN_POINTS}+). Yahoo Finance may have returned malformed data.`
    );
  }
  return points;
}
