import { useState, useEffect, useRef, useCallback } from "react";

// Hit backend directly (avoids proxy issues). Base URL including /api
const API_BASE = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "http://127.0.0.1:4000";
const API = `${API_BASE}/api`;

function formatDollars(cents: unknown): string {
  const n = Number(cents);
  if (Number.isNaN(n)) return "—";
  return (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Card code "10H" -> "10♥", "AS" -> "A♠" */
function formatCard(code: string): string {
  if (!code || code.length < 2) return String(code);
  const suit = { H: "♥", D: "♦", C: "♣", S: "♠" }[code.slice(-1)] ?? code.slice(-1);
  const rank = code.slice(0, -1);
  return rank + suit;
}

function formatHand(cards: unknown, total: unknown): string {
  const arr = Array.isArray(cards) ? cards : [];
  const totalStr = total != null && total !== "" ? ` (${total})` : "";
  return arr.map((c) => formatCard(String(c))).join(", ") + totalStr;
}

/** Stream event from POST /api/blackjack/play-stream */
type StreamEv =
  | { type: "hand_start"; handIndex: number; totalHands: number }
  | { type: "bet"; betCents: number; reasoning?: string | null }
  | { type: "deal"; playerCards: string[]; playerTotal: number; dealerUpcard: string }
  | { type: "reasoning_chunk"; text: string }
  | { type: "decision"; decision: string; reasoning: string | null }
  | { type: "player_card"; card: string; playerCards: string[]; playerTotal: number }
  | { type: "dealer_reveal"; dealerCards: string[]; dealerTotal: number }
  | { type: "dealer_draw"; card: string; dealerCards: string[]; dealerTotal: number }
  | { type: "outcome"; outcome: string; pnlCents: number; balanceCentsAfter: number }
  | { type: "hand_end"; handIndex: number }
  | { type: "error"; message: string }
  | { type: "done" };

/** Stream events from POST /api/blackjack/play-stream when body has modelIdA + modelIdB (VS mode) */
type StreamEvVs =
  | { type: "hand_start"; handIndex: number; totalHands: number }
  | { type: "deal_vs"; playerACards: string[]; playerATotal: number; playerBCards: string[]; playerBTotal: number; dealerUpcard: string }
  | { type: "bet"; player: "a" | "b"; betCents: number; reasoning: string | null }
  | { type: "reasoning_chunk"; player: "a" | "b"; text: string }
  | { type: "decision"; player: "a" | "b"; decision: string; reasoning: string | null }
  | { type: "player_card"; player: "a" | "b"; card: string; playerCards: string[]; playerTotal: number }
  | { type: "dealer_reveal"; dealerCards: string[]; dealerTotal: number }
  | { type: "dealer_draw"; card: string; dealerCards: string[]; dealerTotal: number }
  | { type: "outcome_vs"; playerA: { outcome: string; pnlCents: number; balanceCentsAfter: number }; playerB: { outcome: string; pnlCents: number; balanceCentsAfter: number } }
  | { type: "hand_end"; handIndex: number }
  | { type: "error"; message: string }
  | { type: "done" };

type TabId = "home" | "blackjack" | "crop";
type AIModel = { id: string; name: string };

/** Always show both models in dropdowns; same OpenAI key works for both */
const AI_MODEL_OPTIONS: AIModel[] = [
  { id: "openai-gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "openai-gpt-4o", name: "GPT-4o" },
];

type LeaderboardRow = { modelId: string; name: string; pnlCents: number };
type LeaderboardHistoryPoint = { handIndex: number; cumulativePnlCents: number };
type LeaderboardHistorySeries = { modelId: string; name: string; points: LeaderboardHistoryPoint[] };
type PerformanceBet = { id: string; domain: string; model_id: string; period: string; direction: string; amount_cents: number; outcome: string; payout_cents?: number | null };
type Next3Bet = { id: string; model_a_id: string; model_b_id: string; direction: string; amount_cents: number; outcome: string; payout_cents?: number | null };
type OddsHistoryPoint = { time: string; impliedYesPct: number; totalYesCents: number; totalNoCents: number };
type Next3OddsHistoryPoint = { time: string; impliedAWinsPct: number; totalACents: number; totalBCents: number };

/** One hand's worth of reasoning + cards for the scrollable log */
type HandReasoningEntry = {
  handIndex: number;
  totalHands: number;
  betCents: number | null;
  betReasoning: string | null;
  playerCards: string[];
  playerTotal: number | null;
  dealerUpcard: string | null;
  dealerCards: string[];
  dealerTotal: number | null;
  decision: string | null;
  outcome: string | null;
  pnlCents: number | null;
  reasoningText: string;
};

/** One hand in VS mode: per-player bet + play reasoning for scrollable recap */
type VsHandReasoningEntry = {
  handIndex: number;
  totalHands: number;
  playerA: { betCents: number | null; betReasoning: string | null; reasoningText: string; cards: string[]; total: number | null; outcome: string | null; pnlCents: number | null };
  playerB: { betCents: number | null; betReasoning: string | null; reasoningText: string; cards: string[]; total: number | null; outcome: string | null; pnlCents: number | null };
  dealerUpcard: string | null;
  dealerCards: string[];
  dealerTotal: number | null;
};

type CropHistoryEntry = {
  date: string;
  pricePerBushel: number;
  cashCents: number;
  bushels: number;
  valueCents: number;
  costBasisCents?: number;
  trade?: string;
  size?: number;
  reasoning?: string | null;
  longTermBushelsPerAcre?: number | null;
  reasonLongTerm?: string | null;
};

/** Crop test result from POST /api/crop/run-test (single model). */
type CropTestResult = {
  modelId: string;
  prices: { date: string; pricePerBushel: number; close: number }[];
  history: CropHistoryEntry[];
  finalValueCents: number;
  startValueCents: number;
};

/** Crop test result from POST /api/crop/run-test-vs (two models). */
type CropTestResultVs = {
  modelAId: string;
  modelBId: string;
  prices: { date: string; pricePerBushel: number; close: number }[];
  historyA: CropHistoryEntry[];
  historyB: CropHistoryEntry[];
  finalValueCentsA: number;
  finalValueCentsB: number;
  startValueCents: number;
};

type CropNextTestBet = { id: string; model_a_id: string; model_b_id: string; direction: string; amount_cents: number; outcome: string; payout_cents: number | null };
type CropLongTermBet = { id: string; model_id: string; period: string; prediction_bu_per_acre: number | null; direction: string; amount_cents: number; outcome: string; payout_cents: number | null };

type CropAutoPlayStatus = {
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  intervalMs: number;
  modelAId: string | null;
  modelBId: string | null;
  lastResult: CropTestResultVs | null;
  lastError?: string | null;
  running?: boolean;
  currentPricePerBushel?: number;
  liveValueCentsA?: number;
  liveValueCentsB?: number;
  /** Unrealized P/L (bushels * (currentPrice - avgCost)). When avgCost === currentPrice → P/L = 0 */
  pnlCentsA?: number;
  pnlCentsB?: number;
  /** Average cost basis ¢/bu */
  avgCostCentsPerBushelA?: number;
  avgCostCentsPerBushelB?: number;
};

function CropBenchmarkSection({ API, onBalanceChange }: { API: string; onBalanceChange?: () => void }) {
  const [cropModels, setCropModels] = useState<AIModel[]>([]);
  const [cropModelA, setCropModelA] = useState("");
  const [cropModelB, setCropModelB] = useState("");
  const [cropAutoPlayStatus, setCropAutoPlayStatus] = useState<CropAutoPlayStatus | null>(null);
  const [cropNow, setCropNow] = useState(Date.now());
  const [cropResultVs, setCropResultVs] = useState<CropTestResultVs | null>(null);
  const [cropError, setCropError] = useState("");
  const [cropNextTestBets, setCropNextTestBets] = useState<CropNextTestBet[]>([]);
  const [cropLongTermBets, setCropLongTermBets] = useState<CropLongTermBet[]>([]);
  const [cropNextTestDir, setCropNextTestDir] = useState<"a_wins" | "b_wins">("a_wins");
  const [cropNextTestAmount, setCropNextTestAmount] = useState("10");
  const [cropNextTestLoading, setCropNextTestLoading] = useState(false);
  const [cropLongTermModel, setCropLongTermModel] = useState("");
  const [cropLongTermPeriod, setCropLongTermPeriod] = useState(new Date().getFullYear().toString());
  const [cropLongTermPrediction, setCropLongTermPrediction] = useState("");
  const [cropLongTermDir, setCropLongTermDir] = useState<"yes" | "no">("yes");
  const [cropLongTermAmount, setCropLongTermAmount] = useState("10");
  const [cropLongTermLoading, setCropLongTermLoading] = useState(false);
  const [cropNextTestOddsHistory, setCropNextTestOddsHistory] = useState<{ time: string; impliedAWinsPct: number; totalACents: number; totalBCents: number }[]>([]);
  const [cropLongTermOddsHistory, setCropLongTermOddsHistory] = useState<{ time: string; impliedYesPct: number; totalYesCents: number; totalNoCents: number }[]>([]);
  const [cropSyncLoading, setCropSyncLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/crop/models`)
      .then((r) => r.json())
      .then((d) => {
        const list = d?.models ?? [];
        setCropModels(list);
        setCropModelA((prev) => (prev ? prev : list[0]?.id ?? ""));
        setCropModelB((prev) => (prev ? prev : list[1]?.id ?? list[0]?.id ?? ""));
        setCropLongTermModel((prev) => (prev ? prev : list[0]?.id ?? ""));
      })
      .catch(() => setCropModels([]));
  }, [API]);

  const fetchCropBets = useCallback(() => {
    fetch(`${API}/crop/bets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.nextTestBets) setCropNextTestBets(d.nextTestBets);
        if (d?.longTermBets) setCropLongTermBets(d.longTermBets);
      })
      .catch(() => {});
  }, [API]);
  useEffect(() => {
    fetchCropBets();
  }, [fetchCropBets]);
  useEffect(() => {
    if (cropResultVs) fetchCropBets();
  }, [cropResultVs, fetchCropBets]);

  const fetchCropAutoPlayStatus = useCallback(() => {
    fetch(`${API}/crop/auto-play-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setCropAutoPlayStatus(d);
          if (d.lastResult) setCropResultVs(d.lastResult);
        }
      })
      .catch(() => setCropAutoPlayStatus(null));
  }, [API]);

  useEffect(() => {
    fetchCropAutoPlayStatus();
    const t = setInterval(fetchCropAutoPlayStatus, 5000); // Poll every 5s to pick up results quickly
    return () => clearInterval(t);
  }, [fetchCropAutoPlayStatus]);

  useEffect(() => {
    if (!cropAutoPlayStatus?.enabled || !cropAutoPlayStatus?.nextRunAt) return;
    const tick = setInterval(() => setCropNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [cropAutoPlayStatus?.enabled, cropAutoPlayStatus?.nextRunAt]);

  useEffect(() => {
    if (!cropAutoPlayStatus?.enabled) return;
    const run = () => {
      fetchCropBets();
      onBalanceChange?.();
    };
    run();
    const t = setInterval(run, 20000);
    return () => clearInterval(t);
  }, [cropAutoPlayStatus?.enabled, fetchCropBets, onBalanceChange]);

  useEffect(() => {
    if (!cropModelA || !cropModelB || cropModelA === cropModelB) {
      setCropNextTestOddsHistory([]);
      return;
    }
    fetch(`${API}/crop/odds-history-next-test?modelAId=${encodeURIComponent(cropModelA)}&modelBId=${encodeURIComponent(cropModelB)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCropNextTestOddsHistory(d?.series ?? []))
      .catch(() => setCropNextTestOddsHistory([]));
  }, [API, cropModelA, cropModelB, cropNextTestBets]);

  useEffect(() => {
    if (!cropLongTermModel || !cropLongTermPeriod) {
      setCropLongTermOddsHistory([]);
      return;
    }
    fetch(`${API}/crop/odds-history-longterm?modelId=${encodeURIComponent(cropLongTermModel)}&period=${encodeURIComponent(cropLongTermPeriod)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCropLongTermOddsHistory(d?.series ?? []))
      .catch(() => setCropLongTermOddsHistory([]));
  }, [API, cropLongTermModel, cropLongTermPeriod, cropLongTermBets]);

  const placeCropNextTestBet = () => {
    const amountCents = Math.round(parseFloat(cropNextTestAmount || "0") * 100);
    if (!cropModelA || !cropModelB || cropModelA === cropModelB || amountCents <= 0) return;
    setCropNextTestLoading(true);
    fetch(`${API}/crop/bet-next-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelIdA: cropModelA, modelIdB: cropModelB, direction: cropNextTestDir, amountCents }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        fetchCropBets();
        onBalanceChange?.();
      })
      .catch((e) => setCropError(e instanceof Error ? e.message : "Bet failed"))
      .finally(() => setCropNextTestLoading(false));
  };

  const placeCropLongTermBet = () => {
    const amountCents = Math.round(parseFloat(cropLongTermAmount || "0") * 100);
    if (!cropLongTermModel || amountCents <= 0) return;
    const predictionBu = cropLongTermPrediction.trim() ? parseFloat(cropLongTermPrediction) : null;
    setCropLongTermLoading(true);
    fetch(`${API}/crop/bet-longterm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: cropLongTermModel, period: cropLongTermPeriod, predictionBuPerAcre: predictionBu, direction: cropLongTermDir, amountCents }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        fetchCropBets();
        onBalanceChange?.();
      })
      .catch((e) => setCropError(e instanceof Error ? e.message : "Bet failed"))
      .finally(() => setCropLongTermLoading(false));
  };

  const chartHeight = 220;
  const chartWidth = 540;
  const padding = { top: 8, right: 8, bottom: 24, left: 48 };
  const innerW = chartWidth - padding.left - padding.right;
  const innerH = chartHeight - padding.top - padding.bottom;
  const historyA = cropResultVs?.historyA ?? [];
  const historyB = cropResultVs?.historyB ?? [];
  const liveA = cropAutoPlayStatus?.liveValueCentsA;
  const liveB = cropAutoPlayStatus?.liveValueCentsB;
  const currentPrice = cropAutoPlayStatus?.currentPricePerBushel;
  const valsA = liveA != null && historyA.length > 0 ? [...historyA.map((h) => h.valueCents), liveA] : historyA.map((h) => h.valueCents);
  const valsB = liveB != null && historyB.length > 0 ? [...historyB.map((h) => h.valueCents), liveB] : historyB.map((h) => h.valueCents);
  const allValues = [...valsA, ...valsB];
  const minV = allValues.length ? Math.min(...allValues) : 0;
  const maxV = allValues.length ? Math.max(...allValues) : 10000000;
  const range = maxV - minV || 1;
  const pointsA = valsA.map((v, i) => {
    const x = padding.left + (i / Math.max(1, valsA.length - 1)) * innerW;
    const y = padding.top + innerH - ((v - minV) / range) * innerH;
    return `${x},${y}`;
  }).join(" ");
  const pointsB = valsB.map((v, i) => {
    const x = padding.left + (i / Math.max(1, valsB.length - 1)) * innerW;
    const y = padding.top + innerH - ((v - minV) / range) * innerH;
    return `${x},${y}`;
  }).join(" ");

  const nameA = cropModels.find((m) => m.id === cropResultVs?.modelAId)?.name ?? cropResultVs?.modelAId ?? "A";
  const nameB = cropModels.find((m) => m.id === cropResultVs?.modelBId)?.name ?? cropResultVs?.modelBId ?? "B";

  // P/L: use unrealized (bushels * (price - avgCost)) when we have cost basis; else value - startValue
  const priceForPnl = currentPrice ?? historyA[historyA.length - 1]?.pricePerBushel ?? historyB[historyB.length - 1]?.pricePerBushel;
  const lastA = historyA[historyA.length - 1];
  const lastB = historyB[historyB.length - 1];
  const costBasisA = lastA?.costBasisCents;
  const costBasisB = lastB?.costBasisCents;
  const hasCostBasisA = lastA && lastA.bushels > 0 && typeof costBasisA === "number" && costBasisA > 0;
  const hasCostBasisB = lastB && lastB.bushels > 0 && typeof costBasisB === "number" && costBasisB > 0;
  const pnlA = cropAutoPlayStatus?.pnlCentsA != null ? cropAutoPlayStatus.pnlCentsA
    : hasCostBasisA && priceForPnl != null && priceForPnl > 0 && lastA && costBasisA != null
      ? Math.round(lastA.bushels * (priceForPnl * 100 - costBasisA / lastA.bushels))
      : (liveA ?? cropResultVs?.finalValueCentsA ?? 0) - (cropResultVs?.startValueCents ?? 0);
  const pnlB = cropAutoPlayStatus?.pnlCentsB != null ? cropAutoPlayStatus.pnlCentsB
    : hasCostBasisB && priceForPnl != null && priceForPnl > 0 && lastB && costBasisB != null
      ? Math.round(lastB.bushels * (priceForPnl * 100 - costBasisB / lastB.bushels))
      : (liveB ?? cropResultVs?.finalValueCentsB ?? 0) - (cropResultVs?.startValueCents ?? 0);
  const avgCostA = cropAutoPlayStatus?.avgCostCentsPerBushelA ?? (hasCostBasisA && lastA && costBasisA != null ? costBasisA / lastA.bushels : undefined);
  const avgCostB = cropAutoPlayStatus?.avgCostCentsPerBushelB ?? (hasCostBasisB && lastB && costBasisB != null ? costBasisB / lastB.bushels : undefined);

  // Long-term bu/acre over time (carry forward missing)
  const buSeriesA: { date: string; bu: number }[] = [];
  let lastBuA: number | null = null;
  historyA.forEach((h) => {
    if (h.longTermBushelsPerAcre != null) lastBuA = h.longTermBushelsPerAcre;
    if (lastBuA != null) buSeriesA.push({ date: h.date, bu: lastBuA });
  });
  const buSeriesB: { date: string; bu: number }[] = [];
  let lastBuB: number | null = null;
  historyB.forEach((h) => {
    if (h.longTermBushelsPerAcre != null) lastBuB = h.longTermBushelsPerAcre;
    if (lastBuB != null) buSeriesB.push({ date: h.date, bu: lastBuB });
  });
  const allBu = [...buSeriesA.map((x) => x.bu), ...buSeriesB.map((x) => x.bu)];
  const minBu = allBu.length ? Math.min(...allBu) : 0;
  const maxBu = allBu.length ? Math.max(...allBu) : 200;
  const buRange = maxBu - minBu || 1;
  const buChartHeight = 200;
  const buPadding = { top: 8, right: 8, bottom: 24, left: 44 };
  const buInnerW = chartWidth - buPadding.left - buPadding.right;
  const buInnerH = buChartHeight - buPadding.top - buPadding.bottom;
  const buPointsA = buSeriesA.length > 0 ? buSeriesA.map((p, i) => {
    const x = buPadding.left + (i / Math.max(1, buSeriesA.length - 1)) * buInnerW;
    const y = buPadding.top + buInnerH - ((p.bu - minBu) / buRange) * buInnerH;
    return `${x},${y}`;
  }).join(" ") : "";
  const buPointsB = buSeriesB.length > 0 ? buSeriesB.map((p, i) => {
    const x = buPadding.left + (i / Math.max(1, buSeriesB.length - 1)) * buInnerW;
    const y = buPadding.top + buInnerH - ((p.bu - minBu) / buRange) * buInnerH;
    return `${x},${y}`;
  }).join(" ") : "";
  const hasBuChart = buSeriesA.length > 0 || buSeriesB.length > 0;

  const renderLongTermSection = (title: string, history: CropHistoryEntry[]) => {
    const latest = history.length > 0 ? history[history.length - 1] : null;
    const bu = latest?.longTermBushelsPerAcre;
    const reason = latest?.reasonLongTerm;
    if (bu == null && !reason) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 8 }}>{title} — Long-term prediction</div>
        <div style={{ padding: "14px 16px", background: "#27272a", borderRadius: 8, border: "1px solid #3f3f46" }}>
          {bu != null && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>US corn yield (bushels per acre): </span>
              <strong style={{ fontSize: "1.05rem" }}>{Number(bu).toFixed(1)} bu/acre</strong>
            </div>
          )}
          {reason && (
            <div style={{ fontSize: "0.85rem", color: "#a1a1aa", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{reason}</div>
          )}
        </div>
      </div>
    );
  };

  const renderDecisionList = (history: CropHistoryEntry[], liveValueCents?: number, currentPricePerBushel?: number) => (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 480, overflowY: "auto", overflowX: "hidden", overflowAnchor: "none", overscrollBehavior: "contain" }}>
      {history.map((h, i) => {
        const isLast = i === history.length - 1;
        const useLiveValue = isLast && liveValueCents != null && currentPricePerBushel != null && currentPricePerBushel > 0;
        const displayValueCents = useLiveValue ? liveValueCents : h.valueCents;
        const displayPrice = useLiveValue ? currentPricePerBushel : h.pricePerBushel;
        const tradeLabel = h.trade === "buy" ? "Buy" : h.trade === "sell" ? "Sell" : "Hold";
        const sizeLabel = h.trade === "buy" && h.size != null ? `$${Number(h.size).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : h.trade === "sell" && h.size != null ? `${Number(h.size).toFixed(0)} bushels` : "";
        const cashDollars = (h.cashCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
        const cornValueDollars = (h.bushels * displayPrice).toLocaleString("en-US", { minimumFractionDigits: 2 });
        const totalDollars = (displayValueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
        const cornValueCents = h.bushels * displayPrice * 100;
        const exposurePct = displayValueCents > 0 ? Math.round((cornValueCents / displayValueCents) * 100) : 0;
        return (
          <li key={i} style={{ marginBottom: 10, padding: "10px 12px", background: "#27272a", borderRadius: 8, border: "1px solid #3f3f46" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ color: "#a1a1aa", fontSize: "0.85rem" }}>{h.date}{useLiveValue ? " (live)" : ""}</span>
              <span style={{ fontWeight: 600, color: h.trade === "buy" ? "#22c55e" : h.trade === "sell" ? "#ef4444" : "#a1a1aa" }}>
                {tradeLabel}{sizeLabel ? ` ${sizeLabel}` : ""}
              </span>
              <span style={{ color: "#71717a", fontSize: "0.85rem" }}>
                Corn {(displayPrice * 100).toFixed(2)}¢/bu
              </span>
              {h.longTermBushelsPerAcre != null && (
                <span style={{ color: "#a78bfa", fontSize: "0.85rem" }}>Long-term: {Number(h.longTermBushelsPerAcre).toFixed(1)} bu/acre</span>
              )}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
              Portfolio: <span style={{ color: "#e2e8f0" }}>${cashDollars} cash</span>
              {h.bushels > 0 && (
                <> · <span style={{ color: "#fbbf24" }}>{h.bushels.toLocaleString()} bu corn</span> (<span style={{ color: "#e2e8f0" }}>${cornValueDollars}</span>)</>
              )}
              <> · {exposurePct}% corn exposure · <span style={{ fontWeight: 600 }}>${totalDollars} total</span></>
            </div>
            {h.reasoning && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #3f3f46" }}>
                <span style={{ fontSize: "0.75rem", color: "#71717a", display: "block", marginBottom: 2 }}>Decision (price → market view → your forecast → trade)</span>
                <div style={{ fontSize: "0.85rem", color: "#e4e4e7", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{h.reasoning}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div style={{ maxWidth: 640, padding: "24px 0" }}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Crop prediction AI benchmark</h2>
      <p style={{ color: "#a1a1aa", marginBottom: 24, lineHeight: 1.6 }}>
        US corn futures. Two AIs each get $100k fake capital and make buy/sell decisions. Every 5 min, each agent gets one decision on the latest corn price.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={cropSyncLoading}
          onClick={async () => {
            setCropSyncLoading(true);
            try {
              const r = await fetch(`${API}/hedera/sync`);
              if (r.ok) {
                fetchCropAutoPlayStatus();
              }
            } finally {
              setCropSyncLoading(false);
            }
          }}
          style={{
            padding: "8px 14px",
            background: "#334155",
            border: "1px solid #475569",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: "0.9rem",
            cursor: cropSyncLoading ? "not-allowed" : "pointer",
          }}
        >
          {cropSyncLoading ? "Syncing…" : "Sync from HCS"}
        </button>
        <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Refresh charts from Hedera topic</span>
      </div>

      {cropAutoPlayStatus?.enabled && (
        <div style={{ marginBottom: 20, padding: 16, background: "#0f172a", borderRadius: 10, border: "1px solid #334155" }}>
          <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: 6 }}>Auto-play (2 VS AIs)</div>
          <div style={{ fontSize: "1rem", color: "#e2e8f0", fontWeight: 600 }}>
            {cropAutoPlayStatus.modelAId && cropAutoPlayStatus.modelBId
              ? `${cropModels.find((m) => m.id === cropAutoPlayStatus.modelAId)?.name ?? cropAutoPlayStatus.modelAId} vs ${cropModels.find((m) => m.id === cropAutoPlayStatus.modelBId)?.name ?? cropAutoPlayStatus.modelBId}`
              : "— vs —"}
          </div>
          {cropAutoPlayStatus.running && (
            <div style={{ marginTop: 8, fontSize: "0.95rem", color: "#a78bfa" }}>Run in progress…</div>
          )}
          {!cropAutoPlayStatus.running && (
            <div style={{ marginTop: 8, fontSize: "0.95rem", color: "#fde047" }}>
              {cropAutoPlayStatus.nextRunAt
                ? (() => {
                    const rem = Math.max(0, new Date(cropAutoPlayStatus.nextRunAt).getTime() - cropNow);
                    const m = Math.floor(rem / 60000);
                    const s = Math.floor((rem % 60000) / 1000);
                    return `Next crop run in ${m}:${s.toString().padStart(2, "0")}`;
                  })()
                : "Next run: soon…"}
            </div>
          )}
          {cropAutoPlayStatus.lastError && (
            <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#f87171" }}>
              Last run failed: {cropAutoPlayStatus.lastError}
            </div>
          )}
          {cropAutoPlayStatus.lastRunAt && !cropAutoPlayStatus.lastError && (
            <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#94a3b8" }}>
              Last run: {(() => {
                const sec = Math.floor((cropNow - new Date(cropAutoPlayStatus.lastRunAt).getTime()) / 1000);
                if (sec < 60) return `${sec}s ago`;
                const min = Math.floor(sec / 60);
                return `${min} min ago`;
              })()}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: "0.9rem" }}>Model A</label>
          <select
            value={cropModelA}
            onChange={(e) => setCropModelA(e.target.value)}
            style={{
              minWidth: 160,
              padding: "10px 12px",
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              color: "#e4e4e7",
            }}
          >
            {cropModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: "0.9rem" }}>Model B</label>
          <select
            value={cropModelB}
            onChange={(e) => setCropModelB(e.target.value)}
            style={{
              minWidth: 160,
              padding: "10px 12px",
              background: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: 8,
              color: "#e4e4e7",
            }}
          >
            {cropModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {cropError && (
        <p style={{ color: "#ef4444", marginBottom: 16 }}>{cropError}</p>
      )}

      {cropResultVs && (
        <div style={{ marginTop: 24, padding: 16, background: "#18181b", borderRadius: 12, border: "1px solid #3f3f46" }}>
          <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
            <div>
              <span style={{ color: "#71717a", fontSize: "0.85rem" }}>{nameA} {liveA != null ? "value" : "end"}{currentPrice != null ? ` (at ${(currentPrice * 100).toFixed(2)}¢/bu)` : ""}</span>
              <div style={{ fontWeight: 600, color: pnlA >= 0 ? "#22c55e" : "#ef4444" }}>
                ${((liveA ?? cropResultVs.finalValueCentsA) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#71717a" }}>
                P/L {pnlA >= 0 ? "+" : ""}
                ${(pnlA / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                {avgCostA != null && (
                  <span style={{ marginLeft: 8 }}>avg {avgCostA.toFixed(2)}¢/bu</span>
                )}
              </div>
            </div>
            <div>
              <span style={{ color: "#71717a", fontSize: "0.85rem" }}>{nameB} {liveB != null ? "value" : "end"}{currentPrice != null ? ` (at ${(currentPrice * 100).toFixed(2)}¢/bu)` : ""}</span>
              <div style={{ fontWeight: 600, color: pnlB >= 0 ? "#22c55e" : "#ef4444" }}>
                ${((liveB ?? cropResultVs.finalValueCentsB) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: "0.8rem", color: "#71717a" }}>
                P/L {pnlB >= 0 ? "+" : ""}
                ${(pnlB / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                {avgCostB != null && (
                  <span style={{ marginLeft: 8 }}>avg {avgCostB.toFixed(2)}¢/bu</span>
                )}
              </div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <span style={{ color: "#71717a", fontSize: "0.85rem" }}>Start (each)</span>
              <div style={{ fontWeight: 600 }}>${(cropResultVs.startValueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 8 }}>Portfolio value over time</div>
          <svg width={chartWidth} height={chartHeight} style={{ display: "block", overflow: "visible" }}>
            {pointsA.trim() && <polyline fill="none" stroke="#3b82f6" strokeWidth={2} points={pointsA} />}
            {pointsB.trim() && <polyline fill="none" stroke="#f59e0b" strokeWidth={2} points={pointsB} />}
            {historyA.length > 0 && (
              <text x={padding.left} y={padding.top + 12} fill="#71717a" fontSize={11}>
                ${(maxV / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 } as Intl.NumberFormatOptions)}
              </text>
            )}
            {historyA.length > 0 && (
              <text x={padding.left} y={chartHeight - 6} fill="#71717a" fontSize={11}>
                {historyA[0]?.date ?? ""}
              </text>
            )}
            {historyA.length > 1 && (
              <text x={chartWidth - padding.right - 60} y={chartHeight - 6} fill="#71717a" fontSize={11} textAnchor="end">
                {historyA[historyA.length - 1]?.date ?? ""}
              </text>
            )}
          </svg>
          <div style={{ marginTop: 8, display: "flex", gap: 16, fontSize: "0.8rem", color: "#71717a" }}>
            <span><span style={{ color: "#3b82f6", fontWeight: 600 }}>—</span> {nameA}</span>
            <span><span style={{ color: "#f59e0b", fontWeight: 600 }}>—</span> {nameB}</span>
          </div>
          <div style={{ marginTop: 12, fontSize: "0.8rem", color: "#71717a" }}>
            {historyA.length} decisions · Corn price data: {cropResultVs.prices.length} days
          </div>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #3f3f46" }}>
            <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 12 }}>Long-term prediction (bu/acre) over time</div>
            {hasBuChart && (
              <>
                <svg width={chartWidth} height={buChartHeight} style={{ display: "block", overflow: "visible" }}>
                  {buPointsA && <polyline fill="none" stroke="#3b82f6" strokeWidth={2} points={buPointsA} />}
                  {buPointsB && <polyline fill="none" stroke="#f59e0b" strokeWidth={2} points={buPointsB} />}
                  {buSeriesA.length > 0 && (
                    <text x={buPadding.left} y={buPadding.top + 12} fill="#71717a" fontSize={11}>{maxBu.toFixed(0)}</text>
                  )}
                  {buSeriesA.length > 0 && (
                    <text x={buPadding.left} y={buChartHeight - 6} fill="#71717a" fontSize={11}>{buSeriesA[0]?.date ?? ""}</text>
                  )}
                  {buSeriesA.length > 1 && (
                    <text x={chartWidth - buPadding.right - 60} y={buChartHeight - 6} fill="#71717a" fontSize={11} textAnchor="end">
                      {buSeriesA[buSeriesA.length - 1]?.date ?? ""}
                    </text>
                  )}
                </svg>
                <div style={{ marginTop: 6, display: "flex", gap: 16, fontSize: "0.8rem", color: "#71717a" }}>
                  <span><span style={{ color: "#3b82f6", fontWeight: 600 }}>—</span> {nameA}</span>
                  <span><span style={{ color: "#f59e0b", fontWeight: 600 }}>—</span> {nameB}</span>
                </div>
                <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#71717a" }}>
                  Start → end: {nameA} {buSeriesA.length > 0 ? `${buSeriesA[0]?.bu?.toFixed(1) ?? "—"} → ${buSeriesA[buSeriesA.length - 1]?.bu?.toFixed(1) ?? "—"} bu/acre` : "—"} · {nameB} {buSeriesB.length > 0 ? `${buSeriesB[0]?.bu?.toFixed(1) ?? "—"} → ${buSeriesB[buSeriesB.length - 1]?.bu?.toFixed(1) ?? "—"} bu/acre` : "—"}
                </div>
              </>
            )}
            <div style={{ marginTop: 16, marginBottom: 4, fontSize: "0.9rem", fontWeight: 600 }}>Latest long-term prediction & reasoning</div>
            {renderLongTermSection(nameA, historyA)}
            {renderLongTermSection(nameB, historyB)}
          </div>

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #3f3f46", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 10 }}>{nameA} — Decision history {historyA.length > 0 && `(${historyA.length})`}</div>
              {renderDecisionList(historyA, liveA ?? undefined, currentPrice ?? undefined)}
            </div>
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 10 }}>{nameB} — Decision history {historyB.length > 0 && `(${historyB.length})`}</div>
              {renderDecisionList(historyB, liveB ?? undefined, currentPrice ?? undefined)}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 32, padding: 16, background: "#18181b", borderRadius: 12, border: "1px solid #3f3f46" }}>
        <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16 }}>Crop prediction market</div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 10 }}>Next test — who will be more profitable?</div>
          <p style={{ color: "#a1a1aa", fontSize: "0.85rem", marginBottom: 10 }}>Bet on which model will have higher P/L on the next Run test (~30s). Settles when that test completes.</p>
          {cropModelA && cropModelB && cropModelA !== cropModelB && (() => {
            const series = cropNextTestOddsHistory;
            const hasOdds = series.length > 0;
            const lastOdds = hasOdds ? series[series.length - 1] : null;
            const pad = { left: 28, right: 8, top: 6, bottom: 20 };
            const w = 260;
            const h = 72;
            const chartW = w - pad.left - pad.right;
            const chartH = h - pad.top - pad.bottom;
            const pts = hasOdds ? series : [{ time: new Date().toISOString(), impliedAWinsPct: 50, totalACents: 0, totalBCents: 0 }];
            const x = (i: number) => pad.left + (i / Math.max(1, pts.length - 1)) * chartW;
            const y = (pct: number) => pad.top + (1 - pct / 100) * chartH;
            const nextNameA = cropModels.find((m) => m.id === cropModelA)?.name ?? "A";
            const nextNameB = cropModels.find((m) => m.id === cropModelB)?.name ?? "B";
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: "0.7rem", color: "#71717a", marginBottom: 4 }}>Market odds ({nextNameA} wins % over time)</div>
                <svg width={w} height={h} style={{ display: "block" }} viewBox={`0 0 ${w} ${h}`}>
                  <line x1={pad.left} y1={pad.top} x2={pad.left} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={y(50)} x2={w - pad.right} y2={y(50)} stroke="#52525b" strokeWidth={1} strokeDasharray="3 2" />
                  <text x={pad.left - 4} y={y(0)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">100</text>
                  <text x={pad.left - 4} y={y(50)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">50</text>
                  <text x={pad.left - 4} y={y(100)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">0</text>
                  {pts.length >= 2 && (
                    <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.impliedAWinsPct)}`).join(" ")} />
                  )}
                  {pts.length === 1 && <circle cx={x(0)} cy={y(pts[0].impliedAWinsPct)} r={4} fill="#3b82f6" />}
                </svg>
                {lastOdds && (
                  <div style={{ fontSize: "0.75rem", color: "#a1a1aa", marginTop: 2 }}>
                    Current: <strong style={{ color: "#e4e4e7" }}>{lastOdds.impliedAWinsPct}% {nextNameA}</strong>
                    {" "}(${(lastOdds.totalACents / 100).toFixed(0)} {nextNameA} / ${(lastOdds.totalBCents / 100).toFixed(0)} {nextNameB})
                  </div>
                )}
                {!hasOdds && <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: 2 }}>No bets yet — market at 50%</div>}
              </div>
            );
          })()}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Model A</label>
              <select value={cropModelA} onChange={(e) => setCropModelA(e.target.value)} style={{ padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", minWidth: 140 }}>
                {cropModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Model B</label>
              <select value={cropModelB} onChange={(e) => setCropModelB(e.target.value)} style={{ padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", minWidth: 140 }}>
                {cropModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Pick</label>
              <select value={cropNextTestDir} onChange={(e) => setCropNextTestDir(e.target.value as "a_wins" | "b_wins")} style={{ padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}>
                <option value="a_wins">{cropModels.find((m) => m.id === cropModelA)?.name ?? "A"} wins</option>
                <option value="b_wins">{cropModels.find((m) => m.id === cropModelB)?.name ?? "B"} wins</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Amount $</label>
              <input type="number" min="0.01" step="0.01" value={cropNextTestAmount} onChange={(e) => setCropNextTestAmount(e.target.value)} style={{ width: 80, padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }} />
            </div>
            <button type="button" onClick={placeCropNextTestBet} disabled={cropNextTestLoading || !cropModelA || !cropModelB || cropModelA === cropModelB} style={{ padding: "8px 16px", background: cropNextTestLoading ? "#3f3f46" : "#3b82f6", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: cropNextTestLoading ? "not-allowed" : "pointer" }}>
              {cropNextTestLoading ? "Placing…" : "Place bet"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 10 }}>Long-term — will the model’s prediction be right?</div>
          <p style={{ color: "#a1a1aa", fontSize: "0.85rem", marginBottom: 10 }}>Bet Yes (the model’s long-term bu/acre prediction will be right) or No. Resolved when actual US corn yield is known for the period.</p>
          {cropLongTermModel && cropLongTermPeriod && (() => {
            const series = cropLongTermOddsHistory;
            const hasOdds = series.length > 0;
            const lastOdds = hasOdds ? series[series.length - 1] : null;
            const pad = { left: 28, right: 8, top: 6, bottom: 20 };
            const w = 260;
            const h = 72;
            const chartW = w - pad.left - pad.right;
            const chartH = h - pad.top - pad.bottom;
            const pts = hasOdds ? series : [{ time: new Date().toISOString(), impliedYesPct: 50, totalYesCents: 0, totalNoCents: 0 }];
            const x = (i: number) => pad.left + (i / Math.max(1, pts.length - 1)) * chartW;
            const y = (pct: number) => pad.top + (1 - pct / 100) * chartH;
            return (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: "0.7rem", color: "#71717a", marginBottom: 4 }}>Market odds (Yes % over time)</div>
                <svg width={w} height={h} style={{ display: "block" }} viewBox={`0 0 ${w} ${h}`}>
                  <line x1={pad.left} y1={pad.top} x2={pad.left} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={y(50)} x2={w - pad.right} y2={y(50)} stroke="#52525b" strokeWidth={1} strokeDasharray="3 2" />
                  <text x={pad.left - 4} y={y(0)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">100</text>
                  <text x={pad.left - 4} y={y(50)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">50</text>
                  <text x={pad.left - 4} y={y(100)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">0</text>
                  {pts.length >= 2 && (
                    <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.impliedYesPct)}`).join(" ")} />
                  )}
                  {pts.length === 1 && <circle cx={x(0)} cy={y(pts[0].impliedYesPct)} r={4} fill="#3b82f6" />}
                </svg>
                {lastOdds && (
                  <div style={{ fontSize: "0.75rem", color: "#a1a1aa", marginTop: 2 }}>
                    Current: <strong style={{ color: "#e4e4e7" }}>{lastOdds.impliedYesPct}% Yes</strong>
                    {" "}(${(lastOdds.totalYesCents / 100).toFixed(0)} Yes / ${(lastOdds.totalNoCents / 100).toFixed(0)} No)
                  </div>
                )}
                {!hasOdds && <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: 2 }}>No bets yet — market at 50%</div>}
              </div>
            );
          })()}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Model</label>
              <select value={cropLongTermModel} onChange={(e) => setCropLongTermModel(e.target.value)} style={{ padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", minWidth: 140 }}>
                {cropModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Period (year)</label>
              <input type="text" value={cropLongTermPeriod} onChange={(e) => setCropLongTermPeriod(e.target.value)} placeholder="2025" style={{ width: 72, padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Prediction (bu/acre, optional)</label>
              <input type="number" min="0" step="0.1" value={cropLongTermPrediction} onChange={(e) => setCropLongTermPrediction(e.target.value)} placeholder="e.g. 175" style={{ width: 88, padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Pick</label>
              <select value={cropLongTermDir} onChange={(e) => setCropLongTermDir(e.target.value as "yes" | "no")} style={{ padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}>
                <option value="yes">Yes (prediction right)</option>
                <option value="no">No (prediction wrong)</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem" }}>Amount $</label>
              <input type="number" min="0.01" step="0.01" value={cropLongTermAmount} onChange={(e) => setCropLongTermAmount(e.target.value)} style={{ width: 80, padding: "8px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }} />
            </div>
            <button type="button" onClick={placeCropLongTermBet} disabled={cropLongTermLoading || !cropLongTermModel} style={{ padding: "8px 16px", background: cropLongTermLoading ? "#3f3f46" : "#3b82f6", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: cropLongTermLoading ? "not-allowed" : "pointer" }}>
              {cropLongTermLoading ? "Placing…" : "Place bet"}
            </button>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #3f3f46", paddingTop: 12 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 8 }}>Your crop bets</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 200, overflowY: "auto", overflowAnchor: "none", overscrollBehavior: "contain" }}>
            {cropNextTestBets.map((b) => {
              const nameA = cropModels.find((m) => m.id === b.model_a_id)?.name ?? b.model_a_id;
              const nameB = cropModels.find((m) => m.id === b.model_b_id)?.name ?? b.model_b_id;
              const pick = b.direction === "a_wins" ? `${nameA} wins` : `${nameB} wins`;
              const outcomeColor = b.outcome === "win" ? "#22c55e" : b.outcome === "loss" ? "#ef4444" : b.outcome === "push" ? "#a1a1aa" : "#71717a";
              return (
                <li key={b.id} style={{ marginBottom: 8, padding: "8px 10px", background: "#27272a", borderRadius: 6, border: "1px solid #3f3f46", fontSize: "0.85rem" }}>
                  <span style={{ color: "#a1a1aa" }}>Next test: {nameA} vs {nameB} — {pick}</span>
                  <span style={{ marginLeft: 8 }}>${(b.amount_cents / 100).toFixed(2)}</span>
                  {b.outcome !== "pending" && (
                    <span style={{ marginLeft: 8, color: outcomeColor, fontWeight: 600 }}>
                      {b.outcome === "win" && b.payout_cents != null
                        ? `Won $${((b.payout_cents - b.amount_cents) / 100).toFixed(2)}`
                        : b.outcome === "push" && b.payout_cents != null
                          ? `Refunded $${(b.payout_cents / 100).toFixed(2)}`
                          : b.outcome === "loss"
                            ? `Lost $${(b.amount_cents / 100).toFixed(2)}`
                            : b.outcome}
                    </span>
                  )}
                </li>
              );
            })}
            {cropLongTermBets.map((b) => {
              const name = cropModels.find((m) => m.id === b.model_id)?.name ?? b.model_id;
              const pred = b.prediction_bu_per_acre != null ? ` ${b.prediction_bu_per_acre.toFixed(1)} bu/acre` : "";
              const outcomeColor = b.outcome === "win" ? "#22c55e" : b.outcome === "loss" ? "#ef4444" : "#71717a";
              return (
                <li key={b.id} style={{ marginBottom: 8, padding: "8px 10px", background: "#27272a", borderRadius: 6, border: "1px solid #3f3f46", fontSize: "0.85rem" }}>
                  <span style={{ color: "#a1a1aa" }}>Long-term: {name} {b.period}{pred} — {b.direction === "yes" ? "Yes" : "No"}</span>
                  <span style={{ marginLeft: 8 }}>${(b.amount_cents / 100).toFixed(2)}</span>
                  {b.outcome !== "pending" && <span style={{ marginLeft: 8, color: outcomeColor, fontWeight: 600 }}>{b.outcome}</span>}
                </li>
              );
            })}
            {cropNextTestBets.length === 0 && cropLongTermBets.length === 0 && (
              <li style={{ color: "#71717a", fontSize: "0.85rem" }}>No crop bets yet.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [models, setModels] = useState<AIModel[]>(AI_MODEL_OPTIONS);
  const [selectedModel, setSelectedModel] = useState(AI_MODEL_OPTIONS[0]?.id ?? "");
  const [balance, setBalance] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [numHands, setNumHands] = useState(3);
  const [streaming, setStreaming] = useState(false);
  const [modelA, setModelA] = useState(AI_MODEL_OPTIONS[0]?.id ?? "");
  const [modelB, setModelB] = useState(AI_MODEL_OPTIONS[1]?.id ?? AI_MODEL_OPTIONS[0]?.id ?? "");
  const [numHandsVs, setNumHandsVs] = useState(3);
  const [streamingVs, setStreamingVs] = useState(false);
  const [vsState, setVsState] = useState<{
    handIndex: number;
    totalHands: number;
    playerACards: string[];
    playerATotal: number | null;
    playerBCards: string[];
    playerBTotal: number | null;
    dealerCards: (string | null)[];
    dealerTotal: number | null;
    betA: number | null;
    betB: number | null;
    reasoningA: string;
    reasoningB: string;
    outcomeA: string | null;
    outcomeB: string | null;
    pnlA: number | null;
    pnlB: number | null;
    balanceA: number | null;
    balanceB: number | null;
    vsHandLog: { hand: number; outcomeA: string; outcomeB: string; pnlA: number; pnlB: number }[];
    vsHandReasonings: VsHandReasoningEntry[];
  }>({
    handIndex: 0,
    totalHands: 0,
    playerACards: [],
    playerATotal: null,
    playerBCards: [],
    playerBTotal: null,
    dealerCards: [],
    dealerTotal: null,
    betA: null,
    betB: null,
    reasoningA: "",
    reasoningB: "",
    outcomeA: null,
    outcomeB: null,
    pnlA: null,
    pnlB: null,
    balanceA: null,
    balanceB: null,
    vsHandLog: [],
    vsHandReasonings: [],
  });
  const [streamState, setStreamState] = useState<{
    handIndex: number;
    totalHands: number;
    playerCards: string[];
    playerTotal: number | null;
    dealerCards: (string | null)[];
    dealerTotal: number | null;
    reasoning: string;
    lastDecision: string | null;
    outcome: string | null;
    pnlCents: number | null;
    balanceCentsAfter: number | null;
    handSummaries: { hand: number; outcome: string; pnl: number }[];
    handReasonings: HandReasoningEntry[];
    currentBetCents: number | null;
  }>({
    handIndex: 0,
    totalHands: 0,
    playerCards: [],
    playerTotal: null,
    dealerCards: [],
    dealerTotal: null,
    reasoning: "",
    lastDecision: null,
    outcome: null,
    pnlCents: null,
    balanceCentsAfter: null,
    handSummaries: [],
    handReasonings: [],
    currentBetCents: null,
  });
  const reasoningPanelRef = useRef<HTMLDivElement>(null);
  const reasoningEndRef = useRef<HTMLDivElement>(null);
  const reasoningScrollRef = useRef<HTMLDivElement>(null);
  const [apiUnreachable, setApiUnreachable] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardHistory, setLeaderboardHistory] = useState<LeaderboardHistorySeries[]>([]);
  const [persistedHandHistory, setPersistedHandHistory] = useState<HandReasoningEntry[]>([]);
  const [persistedVsHandReasonings, setPersistedVsHandReasonings] = useState<VsHandReasoningEntry[]>([]);
  const [marketBets, setMarketBets] = useState<PerformanceBet[]>([]);
  const [next3Bets, setNext3Bets] = useState<Next3Bet[]>([]);
  const [userBalanceCents, setUserBalanceCents] = useState<number | null>(null);
  const [userDailyClaimedToday, setUserDailyClaimedToday] = useState(false);
  const [userDailyLoading, setUserDailyLoading] = useState(false);
  const [userWatchAdLoading, setUserWatchAdLoading] = useState(false);

  const fetchUserBalance = useCallback(() => {
    fetch(`${API}/user/balance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setUserBalanceCents(d.balanceCents ?? 0);
          setUserDailyClaimedToday(!!d.dailyClaimedToday);
        }
      })
      .catch(() => {});
  }, [API]);
  useEffect(() => {
    fetchUserBalance();
  }, [fetchUserBalance]);
  useEffect(() => {
    fetchUserBalance();
  }, [lastResult, fetchUserBalance]);
  const [marketPeriod, setMarketPeriod] = useState(() => new Date().toISOString().slice(0, 10));
  const [marketModel, setMarketModel] = useState(AI_MODEL_OPTIONS[0]?.id ?? "");
  const [marketDirection, setMarketDirection] = useState<"outperform" | "underperform">("outperform");
  const [marketAmount, setMarketAmount] = useState("10");
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketSelection, setMarketSelection] = useState<Record<string, "outperform" | "underperform">>({});
  const [next3ModelA, setNext3ModelA] = useState(AI_MODEL_OPTIONS[0]?.id ?? "");
  const [next3ModelB, setNext3ModelB] = useState(AI_MODEL_OPTIONS[1]?.id ?? AI_MODEL_OPTIONS[0]?.id ?? "");
  const [next3Direction, setNext3Direction] = useState<"a_wins" | "b_wins">("a_wins");
  const [next3Loading, setNext3Loading] = useState(false);
  const [oddsHistoryByModel, setOddsHistoryByModel] = useState<Record<string, OddsHistoryPoint[]>>({});
  const [next3OddsHistory, setNext3OddsHistory] = useState<Next3OddsHistoryPoint[]>([]);
  const [autoPlayStatus, setAutoPlayStatus] = useState<{ enabled: boolean; nextHandAt: string | null; lastHandAt: string | null; intervalMs: number; modelAId: string | null; modelBId: string | null } | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastAutoPlayTriggeredRef = useRef<string | null>(null);

  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      fetch(`${API}/blackjack/auto-play-status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setAutoPlayStatus(d))
        .catch(() => setAutoPlayStatus(null));
    };
    poll();
    t = setInterval(poll, 15000);
    return () => { if (t) clearInterval(t); };
  }, []);
  useEffect(() => {
    if (!autoPlayStatus?.enabled || !autoPlayStatus?.nextHandAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [autoPlayStatus?.enabled, autoPlayStatus?.nextHandAt]);

  useEffect(() => {
    if (!autoPlayStatus?.enabled) return;
    const run = () => {
      try {
        refetchLeaderboard();
      } catch (_) {}
      fetch(`${API}/market/bets`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) {
            setMarketBets(d.bets ?? []);
            setNext3Bets(d.next3Bets ?? []);
            try {
              fetchUserBalance();
            } catch (_) {}
          }
        })
        .catch(() => {});
    };
    const interval = setInterval(run, 20000);
    run();
    return () => clearInterval(interval);
  }, [autoPlayStatus?.enabled]);

  useEffect(() => {
    setApiUnreachable(false);
    fetch(`${API}/blackjack/models`)
      .then((r) => r.json())
      .then((d) => {
        const fromApi = d.models || [];
        setModels(fromApi.length >= 2 ? fromApi : AI_MODEL_OPTIONS);
        if (fromApi.length >= 2) {
          if (!selectedModel) setSelectedModel(fromApi[0].id);
          if (!marketModel) setMarketModel(fromApi[0].id);
          if (!modelA) setModelA(fromApi[0].id);
          if (!modelB) setModelB(fromApi[1]?.id ?? fromApi[0].id);
        }
      })
      .catch(() => {
        setModels([]);
        setApiUnreachable(true);
      });
  }, []);

  useEffect(() => {
    if (!selectedModel) return;
    fetch(`${API}/blackjack/daily/${encodeURIComponent(selectedModel)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d ? setBalance(d.balanceCents / 100) : setBalance(null)))
      .catch(() => setBalance(null));
  }, [selectedModel, lastResult]);

  const today = new Date().toISOString().slice(0, 10);
  const refetchLeaderboard = useCallback(() => {
    Promise.all([
      fetch(`${API}/market/leaderboard?domain=blackjack&period=${today}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.leaderboard ?? []),
      fetch(`${API}/market/leaderboard-history?domain=blackjack&period=${today}`).then((r) => (r.ok ? r.json() : null)).then((d) => d?.series ?? []),
    ])
      .then(([board, history]) => {
        setLeaderboard(board);
        setLeaderboardHistory(history);
      })
      .catch(() => {
        setLeaderboard([]);
        setLeaderboardHistory([]);
      });
  }, [today]);

  useEffect(() => {
    if (!selectedModel) return;
    fetch(`${API}/blackjack/hand-history?modelId=${encodeURIComponent(selectedModel)}&date=all`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const hands = d?.hands ?? [];
        setPersistedHandHistory(
          hands.map((h: { handIndex: number; totalHands: number; betCents?: number | null; playerCards?: string[]; dealerUpcard?: string | null; decision?: string | null; outcome?: string | null; pnlCents?: number | null }) => ({
            handIndex: h.handIndex,
            totalHands: h.totalHands,
            betCents: h.betCents ?? null,
            betReasoning: null,
            playerCards: h.playerCards ?? [],
            playerTotal: null,
            dealerUpcard: h.dealerUpcard ?? null,
            dealerCards: [],
            dealerTotal: null,
            decision: h.decision ?? null,
            outcome: h.outcome ?? null,
            pnlCents: h.pnlCents ?? null,
            reasoningText: "",
          }))
        );
      })
      .catch(() => setPersistedHandHistory([]));
  }, [API, selectedModel, lastResult]);
  useEffect(() => {
    if (!modelA || !modelB || modelA === modelB) {
      setPersistedVsHandReasonings([]);
      return;
    }
    Promise.all([
      fetch(`${API}/blackjack/hand-history?modelId=${encodeURIComponent(modelA)}&date=all`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API}/blackjack/hand-history?modelId=${encodeURIComponent(modelB)}&date=all`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([dA, dB]) => {
        const handsA = (dA?.hands ?? []) as Array<Record<string, unknown>>;
        const handsB = (dB?.hands ?? []) as Array<Record<string, unknown>>;
        const pick = (h: Record<string, unknown> | undefined, keys: string[]) => {
          if (!h) return undefined;
          for (const k of keys) if (h[k] !== undefined && h[k] !== null) return h[k];
          return undefined;
        };
        const n = Math.max(handsA.length, handsB.length);
        const merged: VsHandReasoningEntry[] = [];
        for (let i = 0; i < n; i++) {
          const a = handsA[i];
          const b = handsB[i];
          const cardsA = (pick(a, ["playerCards", "player_cards"]) as string[] | undefined) ?? [];
          const cardsB = (pick(b, ["playerCards", "player_cards"]) as string[] | undefined) ?? [];
          const dealerUp = (pick(a, ["dealerUpcard", "dealer_upcard"]) ?? pick(b, ["dealerUpcard", "dealer_upcard"])) as string | null | undefined;
          const dealerC = (pick(a, ["dealerCards", "dealer_cards"]) ?? pick(b, ["dealerCards", "dealer_cards"])) as string[] | undefined;
          merged.push({
            handIndex: i + 1,
            totalHands: n,
            playerA: a
              ? { betCents: (pick(a, ["betCents", "bet_cents"]) as number | null | undefined) ?? null, betReasoning: null, reasoningText: "", cards: Array.isArray(cardsA) ? cardsA : [], total: null, outcome: (pick(a, ["outcome"]) as string | null | undefined) ?? null, pnlCents: (pick(a, ["pnlCents", "pnl_cents"]) as number | null | undefined) ?? null }
              : { betCents: null, betReasoning: null, reasoningText: "", cards: [], total: null, outcome: null, pnlCents: null },
            playerB: b
              ? { betCents: (pick(b, ["betCents", "bet_cents"]) as number | null | undefined) ?? null, betReasoning: null, reasoningText: "", cards: Array.isArray(cardsB) ? cardsB : [], total: null, outcome: (pick(b, ["outcome"]) as string | null | undefined) ?? null, pnlCents: (pick(b, ["pnlCents", "pnl_cents"]) as number | null | undefined) ?? null }
              : { betCents: null, betReasoning: null, reasoningText: "", cards: [], total: null, outcome: null, pnlCents: null },
            dealerUpcard: dealerUp ?? null,
            dealerCards: Array.isArray(dealerC) ? dealerC : [],
            dealerTotal: (pick(a, ["dealerTotal", "dealer_total"]) ?? pick(b, ["dealerTotal", "dealer_total"])) as number | null | undefined ?? null,
          });
        }
        setPersistedVsHandReasonings(merged);
      })
      .catch(() => setPersistedVsHandReasonings([]));
  }, [API, modelA, modelB, lastResult]);
  useEffect(() => {
    refetchLeaderboard();
  }, [lastResult, refetchLeaderboard]);
  useEffect(() => {
    fetch(`${API}/market/bets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setMarketBets(d?.bets ?? []);
        setNext3Bets(d?.next3Bets ?? []);
        fetchUserBalance();
      })
      .catch(() => { setMarketBets([]); setNext3Bets([]); });
  }, [lastResult, fetchUserBalance]);
  useEffect(() => {
    const t = new Date().toISOString().slice(0, 10);
    models.slice(0, 4).forEach((m) => {
      fetch(`${API}/market/odds-history?domain=blackjack&modelId=${encodeURIComponent(m.id)}&period=${t}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.series) setOddsHistoryByModel((prev) => ({ ...prev, [m.id]: d.series }));
        })
        .catch(() => {});
    });
  }, [models, marketBets, lastResult]);
  useEffect(() => {
    const t = new Date().toISOString().slice(0, 10);
    if (!next3ModelA || !next3ModelB || next3ModelA === next3ModelB) {
      setNext3OddsHistory([]);
      return;
    }
    fetch(`${API}/market/odds-history-next3?modelAId=${encodeURIComponent(next3ModelA)}&modelBId=${encodeURIComponent(next3ModelB)}&period=${t}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNext3OddsHistory(d?.series ?? []))
      .catch(() => setNext3OddsHistory([]));
  }, [next3ModelA, next3ModelB, next3Bets, lastResult]);

  const placeMarketBet = (overrides?: { modelId?: string; period?: string; direction?: "outperform" | "underperform"; amount?: string }) => {
    const modelId = overrides?.modelId ?? marketModel ?? models[0]?.id;
    const period = overrides?.period ?? marketPeriod;
    const direction = overrides?.direction ?? marketDirection;
    const amountCents = Math.round(parseFloat(overrides?.amount ?? marketAmount ?? "0") * 100);
    if (!modelId || amountCents <= 0) return;
    setMarketLoading(true);
    fetch(`${API}/market/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "blackjack",
        modelId,
        period,
        direction,
        amountCents,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setMarketBets((prev) => [...prev, { ...d, outcome: "pending" }]);
        fetchUserBalance();
        return fetch(`${API}/market/bets`).then((r) => (r.ok ? r.json() : null)).then((data) => { if (data?.bets != null) setMarketBets(data.bets); });
      })
      .catch((e) => setError(e.message || "Bet failed"))
      .finally(() => setMarketLoading(false));
  };

  const placeNext3Bet = () => {
    const amountCents = Math.round(parseFloat(marketAmount || "0") * 100);
    if (!next3ModelA || !next3ModelB || next3ModelA === next3ModelB || amountCents <= 0) return;
    setNext3Loading(true);
    fetch(`${API}/market/bet-next3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelAId: next3ModelA, modelBId: next3ModelB, direction: next3Direction, amountCents }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setNext3Bets((prev) => [...prev, { ...d, outcome: "pending" }]);
        fetchUserBalance();
        return fetch(`${API}/market/bets`).then((r) => (r.ok ? r.json() : null)).then((data) => {
          if (data?.bets != null) setMarketBets(data.bets);
          if (data?.next3Bets != null) setNext3Bets(data.next3Bets);
        });
      })
      .catch((e) => setError(e.message || "Next-3 bet failed"))
      .finally(() => setNext3Loading(false));
  };

  const playStream = async () => {
    const hands = Math.max(1, Math.min(100, Math.round(Number(numHands) || 1)));
    if (!selectedModel) {
      setError("Select a model.");
      return;
    }
    setError("");
    setStreaming(true);
    setLastResult(null);
    setStreamState({
      handIndex: 0,
      totalHands: hands,
      playerCards: [],
      playerTotal: null,
      dealerCards: [],
      dealerTotal: null,
      reasoning: "",
      lastDecision: null,
      outcome: null,
      pnlCents: null,
      balanceCentsAfter: null,
      handSummaries: [],
      handReasonings: [],
      currentBetCents: null,
    });
    try {
      const res = await fetch(`${API}/blackjack/play-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModel, hands }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || "Stream failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6)) as StreamEv;
              setStreamState((prev) => {
                const next = { ...prev };
                switch (ev.type) {
                  case "hand_start":
                    next.handIndex = ev.handIndex;
                    next.totalHands = ev.totalHands;
                    next.playerCards = [];
                    next.playerTotal = null;
                    next.dealerCards = [];
                    next.dealerTotal = null;
                    next.reasoning = "";
                    next.lastDecision = null;
                    next.outcome = null;
                    next.pnlCents = null;
                    next.balanceCentsAfter = null;
                    next.currentBetCents = null;
                    next.handReasonings = [
                      ...prev.handReasonings,
                      {
                        handIndex: ev.handIndex,
                        totalHands: ev.totalHands,
                        betCents: null,
                        betReasoning: null,
                        playerCards: [],
                        playerTotal: null,
                        dealerUpcard: null,
                        dealerCards: [],
                        dealerTotal: null,
                        decision: null,
                        outcome: null,
                        pnlCents: null,
                        reasoningText: "",
                      },
                    ];
                    break;
                  case "bet":
                    next.currentBetCents = ev.betCents;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        betCents: ev.betCents,
                        betReasoning: ev.reasoning ?? null,
                      });
                    }
                    break;
                  case "deal":
                    next.playerCards = [...ev.playerCards];
                    next.playerTotal = ev.playerTotal;
                    next.dealerCards = [ev.dealerUpcard, null];
                    next.dealerTotal = null;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        playerCards: [...ev.playerCards],
                        playerTotal: ev.playerTotal,
                        dealerUpcard: ev.dealerUpcard,
                      });
                    }
                    break;
                  case "reasoning_chunk":
                    next.reasoning += ev.text;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        reasoningText: last.reasoningText + ev.text,
                      });
                    }
                    break;
                  case "decision":
                    next.lastDecision = ev.decision;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        decision: ev.decision,
                      });
                    }
                    break;
                  case "player_card":
                    next.playerCards = [...ev.playerCards];
                    next.playerTotal = ev.playerTotal;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        playerCards: [...ev.playerCards],
                        playerTotal: ev.playerTotal,
                      });
                    }
                    break;
                  case "dealer_reveal":
                    next.dealerCards = [...ev.dealerCards];
                    next.dealerTotal = ev.dealerTotal;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        dealerCards: [...ev.dealerCards],
                        dealerTotal: ev.dealerTotal,
                      });
                    }
                    break;
                  case "dealer_draw":
                    next.dealerCards = [...ev.dealerCards];
                    next.dealerTotal = ev.dealerTotal;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        dealerCards: [...ev.dealerCards],
                        dealerTotal: ev.dealerTotal,
                      });
                    }
                    break;
                  case "outcome":
                    next.outcome = ev.outcome;
                    next.pnlCents = ev.pnlCents;
                    next.balanceCentsAfter = ev.balanceCentsAfter;
                    if (next.handReasonings.length > 0) {
                      const last = next.handReasonings[next.handReasonings.length - 1];
                      next.handReasonings = next.handReasonings.slice(0, -1).concat({
                        ...last,
                        outcome: ev.outcome,
                        pnlCents: ev.pnlCents,
                      });
                    }
                    break;
                  case "hand_end":
                    if (prev.pnlCents != null)
                      next.handSummaries = [...prev.handSummaries, { hand: prev.handIndex, outcome: prev.outcome ?? "", pnl: prev.pnlCents }];
                    break;
                  case "error":
                    setError(ev.message);
                    break;
                  default:
                    break;
                }
                return next;
              });
            } catch (_) {}
          }
        }
      }
      setBalance(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Stream failed");
    } finally {
      setStreaming(false);
      refetchLeaderboard();
      fetch(`${API}/market/bets`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d?.bets != null) setMarketBets(d.bets);
        if (d?.next3Bets != null) setNext3Bets(d.next3Bets);
      }).catch(() => {});
      if (selectedModel) {
        fetch(`${API}/blackjack/daily/${encodeURIComponent(selectedModel)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d ? setBalance(d.balanceCents / 100) : setBalance(null)))
          .catch(() => setBalance(null));
      }
    }
  };

  const runVsStreamWithModels = useCallback(async (modelAId: string, modelBId: string, hands: number) => {
    setStreamingVs(true);
    setVsState({
      handIndex: 0,
      totalHands: hands,
      playerACards: [],
      playerATotal: null,
      playerBCards: [],
      playerBTotal: null,
      dealerCards: [],
      dealerTotal: null,
      betA: null,
      betB: null,
      reasoningA: "",
      reasoningB: "",
      outcomeA: null,
      outcomeB: null,
      pnlA: null,
      pnlB: null,
      balanceA: null,
      balanceB: null,
      vsHandLog: [],
      vsHandReasonings: [],
    });
    try {
      const res = await fetch(`${API}/blackjack/play-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Blackjack-Mode": "vs",
        },
        body: JSON.stringify({ modelIdA: modelAId, modelIdB: modelBId, hands }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text();
        let errMsg = "VS stream failed";
        try {
          const j = JSON.parse(errText);
          if (j?.error) errMsg = j.error;
        } catch {
          if (errText) errMsg = errText.slice(0, 200);
        }
        throw new Error(errMsg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as StreamEvVs;
            setVsState((prev) => {
              const next = { ...prev };
              switch (ev.type) {
                case "hand_start": {
                  next.handIndex = ev.handIndex;
                  next.totalHands = ev.totalHands;
                  next.playerACards = [];
                  next.playerATotal = null;
                  next.playerBCards = [];
                  next.playerBTotal = null;
                  next.dealerCards = [];
                  next.dealerTotal = null;
                  next.betA = null;
                  next.betB = null;
                  next.reasoningA = "";
                  next.reasoningB = "";
                  next.outcomeA = null;
                  next.outcomeB = null;
                  next.pnlA = null;
                  next.pnlB = null;
                  const emptyPlayer = () => ({ betCents: null, betReasoning: null, reasoningText: "", cards: [], total: null, outcome: null, pnlCents: null });
                  next.vsHandReasonings = [...prev.vsHandReasonings, { handIndex: ev.handIndex, totalHands: ev.totalHands, playerA: emptyPlayer(), playerB: emptyPlayer(), dealerUpcard: null, dealerCards: [], dealerTotal: null }];
                  break;
                }
                case "deal_vs": {
                  next.playerACards = [...ev.playerACards];
                  next.playerATotal = ev.playerATotal;
                  next.playerBCards = [...ev.playerBCards];
                  next.playerBTotal = ev.playerBTotal;
                  next.dealerCards = [ev.dealerUpcard, null];
                  next.dealerTotal = null;
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({
                      ...last,
                      playerA: { ...last.playerA, cards: [...ev.playerACards], total: ev.playerATotal },
                      playerB: { ...last.playerB, cards: [...ev.playerBCards], total: ev.playerBTotal },
                      dealerUpcard: ev.dealerUpcard,
                    });
                  }
                  break;
                }
                case "bet": {
                  if (ev.player === "a") next.betA = ev.betCents;
                  else next.betB = ev.betCents;
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    const key = ev.player === "a" ? "playerA" : "playerB";
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({
                      ...last,
                      [key]: { ...last[key], betCents: ev.betCents, betReasoning: ev.reasoning ?? null },
                    });
                  }
                  break;
                }
                case "reasoning_chunk": {
                  if (ev.player === "a") next.reasoningA += ev.text;
                  else next.reasoningB += ev.text;
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    const key = ev.player === "a" ? "playerA" : "playerB";
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({
                      ...last,
                      [key]: { ...last[key], reasoningText: last[key].reasoningText + ev.text },
                    });
                  }
                  break;
                }
                case "decision":
                  break;
                case "player_card": {
                  if (ev.player === "a") {
                    next.playerACards = [...ev.playerCards];
                    next.playerATotal = ev.playerTotal;
                  } else {
                    next.playerBCards = [...ev.playerCards];
                    next.playerBTotal = ev.playerTotal;
                  }
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    const key = ev.player === "a" ? "playerA" : "playerB";
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({
                      ...last,
                      [key]: { ...last[key], cards: [...ev.playerCards], total: ev.playerTotal },
                    });
                  }
                  break;
                }
                case "dealer_reveal": {
                  next.dealerCards = [...ev.dealerCards];
                  next.dealerTotal = ev.dealerTotal;
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({ ...last, dealerCards: [...ev.dealerCards], dealerTotal: ev.dealerTotal });
                  }
                  break;
                }
                case "dealer_draw": {
                  next.dealerCards = [...ev.dealerCards];
                  next.dealerTotal = ev.dealerTotal;
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({ ...last, dealerCards: [...ev.dealerCards], dealerTotal: ev.dealerTotal });
                  }
                  break;
                }
                case "outcome_vs": {
                  next.outcomeA = ev.playerA.outcome;
                  next.outcomeB = ev.playerB.outcome;
                  next.pnlA = ev.playerA.pnlCents;
                  next.pnlB = ev.playerB.pnlCents;
                  next.balanceA = ev.playerA.balanceCentsAfter;
                  next.balanceB = ev.playerB.balanceCentsAfter;
                  next.vsHandLog = [...prev.vsHandLog, { hand: prev.handIndex, outcomeA: ev.playerA.outcome, outcomeB: ev.playerB.outcome, pnlA: ev.playerA.pnlCents, pnlB: ev.playerB.pnlCents }];
                  if (next.vsHandReasonings.length > 0) {
                    const last = next.vsHandReasonings[next.vsHandReasonings.length - 1];
                    next.vsHandReasonings = next.vsHandReasonings.slice(0, -1).concat({
                      ...last,
                      playerA: { ...last.playerA, outcome: ev.playerA.outcome, pnlCents: ev.playerA.pnlCents },
                      playerB: { ...last.playerB, outcome: ev.playerB.outcome, pnlCents: ev.playerB.pnlCents },
                    });
                  }
                  break;
                }
                case "error":
                  setError(ev.message);
                  break;
                default:
                  break;
              }
              return next;
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "VS stream failed";
      const isNetwork = /network|fetch|failed to fetch|connection|aborted|timeout/i.test(msg);
      setError(isNetwork ? "Connection lost during hand — partial result shown. The hand may have completed on the server; check the leaderboard." : msg);
    } finally {
      setStreamingVs(false);
      setVsState((prev) => ({ ...prev, vsHandReasonings: [] }));
      setLastResult({ vs: Date.now() });
      refetchLeaderboard();
      fetch(`${API}/market/bets`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d?.bets != null) setMarketBets(d.bets);
        if (d?.next3Bets != null) setNext3Bets(d.next3Bets);
      }).catch(() => {});
    }
  }, [refetchLeaderboard]);

  const playStreamVs = async () => {
    const hands = Math.max(1, Math.min(100, Math.round(Number(numHandsVs) || 1)));
    if (!modelA || !modelB || modelA === modelB) {
      setError("Select two different models for VS.");
      return;
    }
    setError("");
    await runVsStreamWithModels(modelA, modelB, hands);
  };

  useEffect(() => {
    if (!autoPlayStatus?.enabled || !autoPlayStatus?.nextHandAt || !autoPlayStatus?.modelAId || !autoPlayStatus?.modelBId || streamingVs) return;
    const nextAt = new Date(autoPlayStatus.nextHandAt).getTime();
    if (now < nextAt) {
      lastAutoPlayTriggeredRef.current = null;
      return;
    }
    if (lastAutoPlayTriggeredRef.current === autoPlayStatus.nextHandAt) return;
    lastAutoPlayTriggeredRef.current = autoPlayStatus.nextHandAt;
    runVsStreamWithModels(autoPlayStatus.modelAId, autoPlayStatus.modelBId, 1);
  }, [autoPlayStatus?.enabled, autoPlayStatus?.nextHandAt, autoPlayStatus?.modelAId, autoPlayStatus?.modelBId, now, streamingVs, runVsStreamWithModels]);

  useEffect(() => {
    const el = reasoningScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }
  }, [streamState.handReasonings]);

  const tabStyle = (id: TabId) => ({
    padding: "10px 16px",
    border: "none",
    borderRadius: 8,
    background: activeTab === id ? "#3f3f46" : "transparent",
    color: activeTab === id ? "#fff" : "#a1a1aa",
    cursor: "pointer",
    fontWeight: activeTab === id ? 600 : 400,
    fontSize: "0.95rem",
  } as const);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "1.75rem", marginBottom: 4, fontWeight: 700 }}>AI Benchmarks</h1>
        <p style={{ color: "#71717a", fontSize: "0.9rem", marginBottom: 16 }}>Compare AI performance across tasks. No data provided — we only ask.</p>
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={tabStyle("home")} onClick={() => setActiveTab("home")}>Home</button>
          <button type="button" style={tabStyle("blackjack")} onClick={() => setActiveTab("blackjack")}>Blackjack AI benchmark</button>
          <button type="button" style={tabStyle("crop")} onClick={() => setActiveTab("crop")}>Crop prediction AI benchmark</button>
        </nav>
        <div style={{ marginTop: 16, padding: "12px 14px", background: "#18181b", borderRadius: 8, border: "1px solid #3f3f46", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <span style={{ fontWeight: 600, color: "#e4e4e7" }}>
            Balance: {userBalanceCents != null ? `$${(userBalanceCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
          </span>
          <button
            type="button"
            disabled={userDailyClaimedToday || userDailyLoading}
            onClick={() => {
              setUserDailyLoading(true);
              fetch(`${API}/user/daily`, { method: "POST" })
                .then((r) => r.json())
                .then((d) => { if (d.error) throw new Error(d.error); fetchUserBalance(); })
                .catch(() => {})
                .finally(() => setUserDailyLoading(false));
            }}
            style={{ padding: "6px 12px", background: userDailyClaimedToday || userDailyLoading ? "#3f3f46" : "#22c55e", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: userDailyClaimedToday || userDailyLoading ? "not-allowed" : "pointer", fontSize: "0.9rem" }}
          >
            {userDailyLoading ? "…" : userDailyClaimedToday ? "Claimed today" : "Claim $1,000 today"}
          </button>
          <button
            type="button"
            disabled={userWatchAdLoading}
            onClick={() => {
              setUserWatchAdLoading(true);
              fetch(`${API}/user/watch-ad`, { method: "POST" })
                .then((r) => r.json())
                .then((d) => { if (d.error) throw new Error(d.error); fetchUserBalance(); })
                .catch(() => {})
                .finally(() => setUserWatchAdLoading(false));
            }}
            style={{ padding: "6px 12px", background: userWatchAdLoading ? "#3f3f46" : "#3b82f6", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: userWatchAdLoading ? "not-allowed" : "pointer", fontSize: "0.9rem" }}
          >
            {userWatchAdLoading ? "…" : "Watch ad for $100 (placeholder)"}
          </button>
        </div>
      </header>

      {activeTab === "home" && (
        <div style={{ padding: "24px 0", maxWidth: 560 }}>
          <p style={{ color: "#a1a1aa", marginBottom: 24, lineHeight: 1.6 }}>
            Choose a benchmark above to run and compare AI models. Each benchmark uses the same principle: we only ask the model; no external data or tools are given.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <button
              type="button"
              onClick={() => setActiveTab("blackjack")}
              style={{
                padding: 20,
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 12,
                color: "#e4e4e7",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4 }}>Blackjack AI benchmark</strong>
              <span style={{ color: "#a1a1aa", fontSize: "0.9rem" }}>$100k/day per AI. Play hands and see P/L. Single model or head-to-head VS.</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("crop")}
              style={{
                padding: 20,
                background: "#18181b",
                border: "1px solid #3f3f46",
                borderRadius: 12,
                color: "#e4e4e7",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4 }}>Crop prediction AI benchmark</strong>
              <span style={{ color: "#a1a1aa", fontSize: "0.9rem" }}>Coming soon. Predict crop outcomes; compare model accuracy.</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === "blackjack" && (
    <div style={{ maxWidth: 560 }}>
      {apiUnreachable && (
        <p style={{ padding: 12, background: "#7f1d1d", color: "#fecaca", borderRadius: 8, marginBottom: 24 }}>
          Can’t reach the API. Start the backend: {API_BASE.startsWith("http://127.0.0.1") ? (
            <><code style={{ background: "#450a0a", padding: "2px 6px" }}>npm run dev:backend</code>, then refresh.</>
          ) : (
            <>Can't reach the API at <code style={{ background: "#450a0a", padding: "2px 6px" }}>{API_BASE}</code>. Set VITE_API_URL in Vercel and redeploy. If backend was asleep, wait ~30s and try again.</>
          )}
        </p>
      )}

      {false && (
        <p style={{ marginBottom: 16 }}>
          Today’s balance: <strong>${(balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
        </p>
      )}


      {false && (streaming || streamState.totalHands > 0) && (
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 340px",
            gap: 16,
            alignItems: "start",
            maxWidth: 920,
          }}
        >
          {/* Left: Live table — like watching at a casino */}
          <div
            style={{
              padding: 20,
              background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)",
              borderRadius: 12,
              border: "1px solid #334155",
              minHeight: 220,
            }}
          >
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontSize: "1rem", color: "#e2e8f0" }}>
                {streamState.totalHands ? `Hand ${streamState.handIndex} of ${streamState.totalHands}` : "—"}
              </strong>
              {streamState.currentBetCents != null && (
                <span style={{ color: "#fde047", fontSize: "0.9rem" }}>
                  AI bet: ${formatDollars(streamState.currentBetCents)}
                </span>
              )}
              {streamState.balanceCentsAfter != null && (
                <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
                  Balance: ${formatDollars(streamState.balanceCentsAfter)}
                </span>
              )}
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: 6 }}>AI (player)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {streamState.playerCards.length === 0 && (
                  <span style={{ color: "#64748b" }}>{streaming ? "Waiting for deal…" : "—"}</span>
                )}
                {streamState.playerCards.map((c, i) => (
                  <span
                    key={i}
                    style={{
                      padding: "10px 14px",
                      background: "#f8fafc",
                      color: "#0f172a",
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: "1.1rem",
                    }}
                  >
                    {formatCard(c)}
                  </span>
                ))}
                {streamState.playerTotal != null && (
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>→ {streamState.playerTotal}</span>
                )}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: 6 }}>Dealer</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {streamState.dealerCards.length === 0 && (
                  <span style={{ color: "#64748b" }}>—</span>
                )}
                {streamState.dealerCards.map((c, i) =>
                  c === null ? (
                    <span
                      key={i}
                      style={{
                        padding: "10px 14px",
                        background: "#475569",
                        color: "#94a3b8",
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: "1.1rem",
                      }}
                    >
                      ?
                    </span>
                  ) : (
                    <span
                      key={i}
                      style={{
                        padding: "10px 14px",
                        background: "#f8fafc",
                        color: "#0f172a",
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: "1.1rem",
                      }}
                    >
                      {formatCard(c)}
                    </span>
                  )
                )}
                {streamState.dealerTotal != null && (
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>→ {streamState.dealerTotal}</span>
                )}
              </div>
            </div>
            {streamState.lastDecision && (
              <p style={{ marginBottom: 4, color: "#cbd5e1" }}>
                <strong>Decision:</strong> {streamState.lastDecision}
              </p>
            )}
            {streamState.outcome && (
              <p style={{ marginBottom: 0, color: (streamState.outcome ?? "") === "win" ? "#86efac" : (streamState.outcome ?? "") === "loss" ? "#fca5a5" : "#fde047" }}>
                <strong>Outcome:</strong> {(streamState.outcome ?? "").toUpperCase()}
                {streamState.pnlCents != null && ` — ${(streamState.pnlCents ?? 0) >= 0 ? "+" : ""}$${formatDollars(streamState.pnlCents)}`}
              </p>
            )}
            {streamState.handSummaries.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #334155" }}>
                <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                  Previous: {streamState.handSummaries.map((s) => `#${s.hand} ${s.outcome} (${s.pnl >= 0 ? "+" : ""}$${(s.pnl / 100).toFixed(2)})`).join(" · ")}
                </span>
              </div>
            )}
          </div>
          {/* Right: Scrollable AI reasoning log — one block per hand with cards + reasoning */}
          <div
            ref={reasoningPanelRef}
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#1c1917",
              borderRadius: 10,
              border: "1px solid #44403c",
              minHeight: 320,
              maxHeight: 520,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #44403c", color: "#a8a29e", fontSize: "0.8rem", fontWeight: 600 }}>
              AI reasoning — scroll to review past hands
            </div>
            <div
              ref={reasoningScrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                overflowAnchor: "none",
                overscrollBehavior: "contain",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {(streamState.handReasonings.length === 0 && persistedHandHistory.length === 0) && (
                <div style={{ color: "#78716c", fontSize: "0.9rem" }}>{streaming ? "Waiting for first hand…" : "—"}</div>
              )}
              {(streamState.handReasonings.length > 0 ? streamState.handReasonings : persistedHandHistory).map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 12,
                    background: "#292524",
                    borderRadius: 8,
                    border: "1px solid #44403c",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#d6d3d1", marginBottom: 6 }}>
                    Hand {entry.handIndex} of {entry.totalHands}
                  </div>
                  {(entry.playerCards.length > 0 || entry.dealerUpcard) && (
                    <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span style={{ color: "#a8a29e", fontSize: "0.7rem", marginRight: 4 }}>Dealt:</span>
                      {entry.playerCards.map((c, i) => (
                        <span
                          key={i}
                          style={{
                            padding: "4px 8px",
                            background: "#fafaf9",
                            color: "#1c1917",
                            borderRadius: 4,
                            fontWeight: 700,
                            fontSize: "0.85rem",
                          }}
                        >
                          {formatCard(c)}
                        </span>
                      ))}
                      {entry.playerTotal != null && (
                        <span style={{ color: "#d6d3d1", fontSize: "0.8rem" }}>({entry.playerTotal})</span>
                      )}
                      {entry.dealerUpcard && (
                        <>
                          <span style={{ color: "#78716c", marginLeft: 4 }}>vs</span>
                          <span
                            style={{
                              padding: "4px 8px",
                              background: "#fef3c7",
                              color: "#1c1917",
                              borderRadius: 4,
                              fontWeight: 700,
                              fontSize: "0.85rem",
                            }}
                          >
                            {formatCard(entry.dealerUpcard)} dealer
                          </span>
                        </>
                      )}
                      {entry.dealerCards.length > 0 && entry.dealerCards.length > 1 && (
                        <span style={{ color: "#a8a29e", fontSize: "0.8rem" }}>
                          → dealer {entry.dealerCards.map((c) => formatCard(c)).join(", ")}
                          {entry.dealerTotal != null && ` (${entry.dealerTotal})`}
                        </span>
                      )}
                    </div>
                  )}
                  {entry.betCents != null && (
                    <div style={{ marginBottom: 6, fontSize: "0.8rem" }}>
                      <span style={{ color: "#fde047" }}>Bet: ${formatDollars(entry.betCents)}</span>
                      {entry.betReasoning && (
                        <span style={{ marginLeft: 8, color: "#a8a29e", fontStyle: "italic" }}>— {entry.betReasoning}</span>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: "0.88rem", lineHeight: 1.5, color: "#e7e5e4", whiteSpace: "pre-wrap" }}>
                    {entry.reasoningText ? (
                      <>
                        <span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>Play reasoning: </span>
                        {entry.reasoningText}
                      </>
                    ) : (
                      streaming && streamState.handReasonings.length > 0 && idx === streamState.handReasonings.length - 1 ? "…" : "—"
                    )}
                  </div>
                  {(entry.decision || entry.outcome) && (
                    <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#a8a29e" }}>
                      {entry.decision && <span>Decision: {entry.decision}</span>}
                      {entry.outcome && (
                        <span style={{ marginLeft: 8, color: entry.outcome === "win" ? "#86efac" : entry.outcome === "loss" ? "#fca5a5" : "#fde047" }}>
                          {entry.outcome.toUpperCase()}
                          {entry.pnlCents != null && ` (${entry.pnlCents >= 0 ? "+" : ""}$${formatDollars(entry.pnlCents)})`}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <span ref={reasoningEndRef} />
            </div>
          </div>
        </div>
      )}

      <hr style={{ border: "none", borderTop: "1px solid #3f3f46", margin: "32px 0 24px" }} />

      {autoPlayStatus?.enabled && (
        <div style={{ marginBottom: 20, padding: 16, background: "#0f172a", borderRadius: 10, border: "1px solid #334155" }}>
          <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: 6 }}>Auto-play (2 VS AIs)</div>
          <div style={{ fontSize: "1rem", color: "#e2e8f0", fontWeight: 600 }}>
            {autoPlayStatus.modelAId && autoPlayStatus.modelBId
              ? `${models.find((m) => m.id === autoPlayStatus.modelAId)?.name ?? autoPlayStatus.modelAId} vs ${models.find((m) => m.id === autoPlayStatus.modelBId)?.name ?? autoPlayStatus.modelBId}`
              : "— vs —"}
          </div>
          <div style={{ marginTop: 8, fontSize: "0.95rem", color: "#fde047" }}>
            {autoPlayStatus.nextHandAt
              ? (() => {
                  const rem = Math.max(0, new Date(autoPlayStatus.nextHandAt).getTime() - now);
                  const m = Math.floor(rem / 60000);
                  const s = Math.floor((rem % 60000) / 1000);
                  return `Next VS hand in ${m}:${s.toString().padStart(2, "0")}`;
                })()
              : "Next hand: soon…"}
          </div>
          {autoPlayStatus.lastHandAt && (
            <div style={{ marginTop: 6, fontSize: "0.8rem", color: "#94a3b8" }}>
              Last hand: {(() => {
                const sec = Math.floor((now - new Date(autoPlayStatus.lastHandAt).getTime()) / 1000);
                if (sec < 60) return `${sec}s ago`;
                const min = Math.floor(sec / 60);
                return `${min} min ago`;
              })()}
            </div>
          )}
        </div>
      )}

      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Two AIs (VS)</h2>
      <p style={{ color: "#a1a1aa", marginBottom: 16 }}>
        Same table, same dealer. Auto-play runs one VS hand every 5 min. Use &quot;Play 3 hands VS&quot; below to test on demand.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem" }}>Model A</label>
          <select value={modelA} onChange={(e) => setModelA(e.target.value)} style={{ minWidth: 140, padding: "8px 12px", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#e4e4e7" }}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem" }}>Model B</label>
          <select value={modelB} onChange={(e) => setModelB(e.target.value)} style={{ minWidth: 140, padding: "8px 12px", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#e4e4e7" }}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 4, fontSize: "0.85rem" }}>Hands</label>
          <input type="number" min={1} max={100} value={numHandsVs} onChange={(e) => setNumHandsVs(Number(e.target.value) || 1)} style={{ width: 64, padding: "8px 12px", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, color: "#e4e4e7" }} />
        </div>
        <button onClick={playStreamVs} disabled={streamingVs || !modelA || !modelB || modelA === modelB} style={{ padding: "12px 24px", background: streamingVs ? "#3f3f46" : modelA === modelB ? "#52525b" : "#16a34a", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: streamingVs || modelA === modelB ? "not-allowed" : "pointer" }}>
          {streamingVs ? "Playing…" : `Play ${numHandsVs} hand${numHandsVs !== 1 ? "s" : ""} VS`}
        </button>
      </div>
      {models.length < 2 && (
        <p style={{ color: "#fbbf24", fontSize: "0.9rem", marginTop: -8, marginBottom: 16 }}>
          Two models needed for VS. Restart the backend to load both (GPT-4o Mini and GPT-4o).
        </p>
      )}
      {models.length >= 2 && modelA === modelB && (
        <p style={{ color: "#a1a1aa", fontSize: "0.9rem", marginTop: -8, marginBottom: 16 }}>
          Choose two different models above (Model A and Model B must differ).
        </p>
      )}
      {models.length >= 2 && (
        <div style={{ marginBottom: 24, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "start", maxWidth: 1000 }}>
          <div style={{ padding: 16, background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)", borderRadius: 12, border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: 8 }}>{models.find((m) => m.id === modelA)?.name ?? "A"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {vsState.playerACards.length === 0 && <span style={{ color: "#64748b" }}>{streamingVs ? "Waiting for deal…" : "—"}</span>}
              {vsState.playerACards.map((c, i) => (
                <span key={i} style={{ padding: "8px 10px", background: "#f8fafc", color: "#0f172a", borderRadius: 6, fontWeight: 700 }}>{formatCard(c)}</span>
              ))}
              {vsState.playerATotal != null && <span style={{ color: "#e2e8f0" }}>→ {vsState.playerATotal}</span>}
            </div>
            {vsState.betA != null && <div style={{ marginTop: 8, color: "#fde047", fontSize: "0.85rem" }}>Bet: ${formatDollars(vsState.betA)}</div>}
            {vsState.outcomeA != null && <div style={{ marginTop: 4, color: vsState.outcomeA === "win" ? "#86efac" : vsState.outcomeA === "loss" ? "#fca5a5" : "#fde047" }}>{vsState.outcomeA.toUpperCase()} {vsState.pnlA != null && `(${vsState.pnlA >= 0 ? "+" : ""}$${formatDollars(vsState.pnlA)})`}</div>}
            {vsState.balanceA != null && <div style={{ marginTop: 4, fontSize: "0.8rem", color: "#94a3b8" }}>Balance: ${formatDollars(vsState.balanceA)}</div>}
          </div>
          <div style={{ padding: 16, background: "linear-gradient(180deg, #1e293b 0%, #0f172a 100%)", borderRadius: 12, border: "1px solid #334155", textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: 8 }}>Dealer</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
              {vsState.dealerCards.length === 0 && <span style={{ color: "#64748b" }}>—</span>}
              {vsState.dealerCards.map((c, i) => (
                <span key={i} style={{ padding: "8px 10px", background: c ? "#f8fafc" : "#475569", color: c ? "#0f172a" : "#94a3b8", borderRadius: 6, fontWeight: 700 }}>{c ? formatCard(c) : "?"}</span>
              ))}
              {vsState.dealerTotal != null && <span style={{ color: "#e2e8f0" }}>→ {vsState.dealerTotal}</span>}
            </div>
            <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#d6d3d1" }}>{vsState.totalHands ? `Hand ${vsState.handIndex} of ${vsState.totalHands}` : "—"}</div>
          </div>
          <div style={{ padding: 16, background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)", borderRadius: 12, border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginBottom: 8 }}>{models.find((m) => m.id === modelB)?.name ?? "B"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {vsState.playerBCards.length === 0 && <span style={{ color: "#64748b" }}>{streamingVs ? "Waiting for deal…" : "—"}</span>}
              {vsState.playerBCards.map((c, i) => (
                <span key={i} style={{ padding: "8px 10px", background: "#f8fafc", color: "#0f172a", borderRadius: 6, fontWeight: 700 }}>{formatCard(c)}</span>
              ))}
              {vsState.playerBTotal != null && <span style={{ color: "#e2e8f0" }}>→ {vsState.playerBTotal}</span>}
            </div>
            {vsState.betB != null && <div style={{ marginTop: 8, color: "#fde047", fontSize: "0.85rem" }}>Bet: ${formatDollars(vsState.betB)}</div>}
            {vsState.outcomeB != null && <div style={{ marginTop: 4, color: vsState.outcomeB === "win" ? "#86efac" : vsState.outcomeB === "loss" ? "#fca5a5" : "#fde047" }}>{vsState.outcomeB.toUpperCase()} {vsState.pnlB != null && `(${vsState.pnlB >= 0 ? "+" : ""}$${formatDollars(vsState.pnlB)})`}</div>}
            {vsState.balanceB != null && <div style={{ marginTop: 4, fontSize: "0.8rem", color: "#94a3b8" }}>Balance: ${formatDollars(vsState.balanceB)}</div>}
          </div>
        </div>
      )}
      {models.length >= 2 && (() => {
        const raw: VsHandReasoningEntry[] =
          vsState.vsHandReasonings.length > 0
            ? [...persistedVsHandReasonings, ...vsState.vsHandReasonings].map((e, i, arr) => ({
                ...e,
                handIndex: i + 1,
                totalHands: arr.length,
              }))
            : persistedVsHandReasonings;
        const displayVsHands = raw.slice().reverse();
        const lastStreamingIdx = vsState.vsHandReasonings.length > 0 ? 0 : -1;
        return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 1000, marginBottom: 24, minHeight: 320 }}>
          {/* Model A: scrollable reasoning — one block per hand with bet + play reasoning */}
          <div style={{ display: "flex", flexDirection: "column", background: "#1c1917", borderRadius: 10, border: "1px solid #44403c", minHeight: 320, maxHeight: 520, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #44403c", color: "#a8a29e", fontSize: "0.8rem", fontWeight: 600 }}>
              {models.find((m) => m.id === modelA)?.name ?? "Model A"} — scroll to review past hands
            </div>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", overflowAnchor: "none", overscrollBehavior: "contain", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
              {(displayVsHands.length === 0) && (
                <div style={{ color: "#78716c", fontSize: "0.9rem" }}>{streamingVs ? "Waiting for first hand…" : "—"}</div>
              )}
              {displayVsHands.map((entry, idx) => (
                <div key={idx} style={{ padding: 12, background: "#292524", borderRadius: 8, border: "1px solid #44403c" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#d6d3d1", marginBottom: 6 }}>Hand {entry.handIndex} of {entry.totalHands}</div>
                  {(entry.playerA.cards.length > 0 || entry.dealerUpcard || entry.playerA.outcome) && (
                    <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span style={{ color: "#a8a29e", fontSize: "0.7rem", marginRight: 4 }}>Cards:</span>
                      {entry.playerA.cards.length > 0 ? (
                        <>
                          {entry.playerA.cards.map((c, i) => (
                            <span key={i} style={{ padding: "4px 8px", background: "#fafaf9", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(c)}</span>
                          ))}
                          {entry.playerA.total != null && <span style={{ color: "#d6d3d1", fontSize: "0.8rem" }}>({entry.playerA.total})</span>}
                          {entry.dealerUpcard && (
                            <>
                              <span style={{ color: "#78716c", marginLeft: 4 }}>vs dealer</span>
                              <span style={{ padding: "4px 8px", background: "#fef3c7", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(entry.dealerUpcard)}</span>
                            </>
                          )}
                          {entry.dealerCards.length > 1 && (
                            <span style={{ color: "#a8a29e", fontSize: "0.8rem" }}>→ dealer {entry.dealerCards.map((c) => formatCard(c)).join(", ")}{entry.dealerTotal != null && ` (${entry.dealerTotal})`}</span>
                          )}
                        </>
                      ) : entry.dealerUpcard ? (
                        <span style={{ color: "#78716c" }}>vs dealer <span style={{ padding: "4px 8px", background: "#fef3c7", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(entry.dealerUpcard)}</span></span>
                      ) : (
                        <span style={{ color: "#78716c" }}>—</span>
                      )}
                    </div>
                  )}
                  {entry.playerA.betCents != null && (
                    <div style={{ marginBottom: 6, fontSize: "0.8rem" }}>
                      <span style={{ color: "#fde047" }}>Bet: ${formatDollars(entry.playerA.betCents)}</span>
                      {entry.playerA.betReasoning && <span style={{ marginLeft: 8, color: "#a8a29e", fontStyle: "italic" }}>— {entry.playerA.betReasoning}</span>}
                    </div>
                  )}
                  <div style={{ fontSize: "0.88rem", lineHeight: 1.5, color: "#e7e5e4", whiteSpace: "pre-wrap" }}>
                    {entry.playerA.reasoningText ? (
                      <><span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>Play reasoning: </span>{entry.playerA.reasoningText}</>
                    ) : (streamingVs && idx === lastStreamingIdx ? "…" : "—")}
                  </div>
                  {entry.playerA.outcome && (
                    <div style={{ marginTop: 8, fontSize: "0.8rem", color: entry.playerA.outcome === "win" ? "#86efac" : entry.playerA.outcome === "loss" ? "#fca5a5" : "#fde047" }}>
                      {entry.playerA.outcome.toUpperCase()}{entry.playerA.pnlCents != null && ` (${entry.playerA.pnlCents >= 0 ? "+" : ""}$${formatDollars(entry.playerA.pnlCents)})`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Model B: same structure */}
          <div style={{ display: "flex", flexDirection: "column", background: "#1c1917", borderRadius: 10, border: "1px solid #44403c", minHeight: 320, maxHeight: 520, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #44403c", color: "#a8a29e", fontSize: "0.8rem", fontWeight: 600 }}>
              {models.find((m) => m.id === modelB)?.name ?? "Model B"} — scroll to review past hands
            </div>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", overflowAnchor: "none", overscrollBehavior: "contain", padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
              {(displayVsHands.length === 0) && (
                <div style={{ color: "#78716c", fontSize: "0.9rem" }}>{streamingVs ? "Waiting for first hand…" : "—"}</div>
              )}
              {displayVsHands.map((entry, idx) => (
                <div key={idx} style={{ padding: 12, background: "#292524", borderRadius: 8, border: "1px solid #44403c" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#d6d3d1", marginBottom: 6 }}>Hand {entry.handIndex} of {entry.totalHands}</div>
                  {(entry.playerB.cards.length > 0 || entry.dealerUpcard || entry.playerB.outcome) && (
                    <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <span style={{ color: "#a8a29e", fontSize: "0.7rem", marginRight: 4 }}>Cards:</span>
                      {entry.playerB.cards.length > 0 ? (
                        <>
                          {entry.playerB.cards.map((c, i) => (
                            <span key={i} style={{ padding: "4px 8px", background: "#fafaf9", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(c)}</span>
                          ))}
                          {entry.playerB.total != null && <span style={{ color: "#d6d3d1", fontSize: "0.8rem" }}>({entry.playerB.total})</span>}
                          {entry.dealerUpcard && (
                            <>
                              <span style={{ color: "#78716c", marginLeft: 4 }}>vs dealer</span>
                              <span style={{ padding: "4px 8px", background: "#fef3c7", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(entry.dealerUpcard)}</span>
                            </>
                          )}
                          {entry.dealerCards.length > 1 && (
                            <span style={{ color: "#a8a29e", fontSize: "0.8rem" }}>→ dealer {entry.dealerCards.map((c) => formatCard(c)).join(", ")}{entry.dealerTotal != null && ` (${entry.dealerTotal})`}</span>
                          )}
                        </>
                      ) : entry.dealerUpcard ? (
                        <span style={{ color: "#78716c" }}>vs dealer <span style={{ padding: "4px 8px", background: "#fef3c7", color: "#1c1917", borderRadius: 4, fontWeight: 700, fontSize: "0.85rem" }}>{formatCard(entry.dealerUpcard)}</span></span>
                      ) : (
                        <span style={{ color: "#78716c" }}>—</span>
                      )}
                    </div>
                  )}
                  {entry.playerB.betCents != null && (
                    <div style={{ marginBottom: 6, fontSize: "0.8rem" }}>
                      <span style={{ color: "#fde047" }}>Bet: ${formatDollars(entry.playerB.betCents)}</span>
                      {entry.playerB.betReasoning && <span style={{ marginLeft: 8, color: "#a8a29e", fontStyle: "italic" }}>— {entry.playerB.betReasoning}</span>}
                    </div>
                  )}
                  <div style={{ fontSize: "0.88rem", lineHeight: 1.5, color: "#e7e5e4", whiteSpace: "pre-wrap" }}>
                    {entry.playerB.reasoningText ? (
                      <><span style={{ color: "#a8a29e", fontSize: "0.75rem" }}>Play reasoning: </span>{entry.playerB.reasoningText}</>
                    ) : (streamingVs && idx === lastStreamingIdx ? "…" : "—")}
                  </div>
                  {entry.playerB.outcome && (
                    <div style={{ marginTop: 8, fontSize: "0.8rem", color: entry.playerB.outcome === "win" ? "#86efac" : entry.playerB.outcome === "loss" ? "#fca5a5" : "#fde047" }}>
                      {entry.playerB.outcome.toUpperCase()}{entry.playerB.pnlCents != null && ` (${entry.playerB.pnlCents >= 0 ? "+" : ""}$${formatDollars(entry.playerB.pnlCents)})`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })()}

      <div style={{ marginBottom: 24, padding: 16, background: "#18181b", borderRadius: 8, border: "1px solid #3f3f46" }}>
        <strong style={{ fontSize: "0.9rem" }}>Today's leaderboard (blackjack P/L over time)</strong>
        <div style={{ marginTop: 12, minHeight: 200 }}>
          {leaderboard.length === 0 && leaderboardHistory.length === 0 && <div style={{ color: "#71717a", fontSize: "0.9rem" }}>No data yet</div>}
          {(leaderboardHistory.length > 0 || leaderboard.length > 0) && (() => {
            const series = leaderboardHistory.length > 0 ? leaderboardHistory : leaderboard.map((r) => ({ modelId: r.modelId, name: r.name, points: [{ handIndex: 1, cumulativePnlCents: r.pnlCents }] }));
            const allPoints = series.flatMap((s) => s.points);
            const maxHand = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.handIndex)));
            const minPnl = Math.min(0, ...allPoints.map((p) => p.cumulativePnlCents));
            const maxPnl = Math.max(0, ...allPoints.map((p) => p.cumulativePnlCents));
            const rangePnl = maxPnl - minPnl || 1;
            const pad = { left: 44, right: 16, top: 20, bottom: 32 };
            const w = 280;
            const h = 200;
            const chartW = w - pad.left - pad.right;
            const chartH = h - pad.top - pad.bottom;
            const x = (hand: number) => pad.left + (hand / maxHand) * chartW;
            const y = (cents: number) => pad.top + (1 - (cents - minPnl) / rangePnl) * chartH;
            const colors = ["#22c55e", "#3b82f6", "#a855f7", "#f59e0b"];
            const yTicks = (() => {
              const steps = [0];
              if (minPnl < 0) steps.push(minPnl);
              if (maxPnl > 0) steps.push(maxPnl);
              const lo = Math.min(0, minPnl);
              const hi = Math.max(0, maxPnl);
              const range = hi - lo || 1;
              const step = range <= 200 ? 100 : range <= 2000 ? 500 : Math.ceil(range / 4 / 100) * 100;
              for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += step) if (!steps.includes(v)) steps.push(v);
              steps.sort((a, b) => a - b);
              return steps;
            })();
            const xTicks = maxHand <= 5 ? Array.from({ length: maxHand + 1 }, (_, i) => i) : [...new Set(Array.from({ length: 6 }, (_, i) => Math.round((i / 5) * maxHand)))].sort((a, b) => a - b);
            return (
              <div>
                <svg width={w} height={h} style={{ display: "block" }} viewBox={`0 0 ${w} ${h}`}>
                  <text x={14} y={pad.top + chartH / 2} textAnchor="middle" fill="#a1a1aa" fontSize="10" transform={`rotate(-90, 14, ${pad.top + chartH / 2})`}>P/L ($)</text>
                  <line x1={pad.left} y1={pad.top} x2={pad.left} y2={h - pad.bottom} stroke="#71717a" strokeWidth={1} />
                  <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="#71717a" strokeWidth={1} />
                  {yTicks.map((cents) => (
                    <g key={cents}>
                      <line x1={pad.left} y1={y(cents)} x2={pad.left - 4} y2={y(cents)} stroke="#71717a" strokeWidth={1} />
                      <text x={pad.left - 6} y={y(cents)} textAnchor="end" dominantBaseline="middle" fill="#a1a1aa" fontSize="9">{cents === 0 ? "0" : (cents > 0 ? "+" : "") + (cents / 100).toFixed(0)}</text>
                    </g>
                  ))}
                  {xTicks.map((hand) => (
                    <g key={hand}>
                      <line x1={x(hand)} y1={h - pad.bottom} x2={x(hand)} y2={h - pad.bottom + 4} stroke="#71717a" strokeWidth={1} />
                      <text x={x(hand)} y={h - pad.bottom + 14} textAnchor="middle" fill="#a1a1aa" fontSize="9">{hand}</text>
                    </g>
                  ))}
                  <text x={pad.left + chartW / 2} y={h - 4} textAnchor="middle" fill="#a1a1aa" fontSize="10">Hand</text>
                  <line x1={pad.left} y1={y(0)} x2={w - pad.right} y2={y(0)} stroke="#52525b" strokeWidth={1} strokeDasharray="4 2" />
                  {series.map((s, i) => {
                    const pts = [{ handIndex: 0, cumulativePnlCents: 0 }, ...s.points];
                    const d = pts.map((p) => `${x(p.handIndex)},${y(p.cumulativePnlCents)}`).join(" ");
                    return <polyline key={s.modelId} fill="none" stroke={colors[i % colors.length]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={d} />;
                  })}
                </svg>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, paddingTop: 8, borderTop: "1px solid #3f3f46", fontSize: "0.8rem" }}>
                  {series.map((s, i) => {
                    const last = s.points[s.points.length - 1];
                    const cents = last ? last.cumulativePnlCents : 0;
                    return (
                      <span key={s.modelId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length] }} />
                        <span style={{ color: "#e4e4e7" }}>{s.name}</span>
                        <span style={{ fontWeight: 600, color: cents >= 0 ? "#22c55e" : "#ef4444" }}>{`${cents >= 0 ? "+" : ""}$${(cents / 100).toFixed(2)}`}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid #3f3f46", margin: "32px 0 24px" }} />

      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Prediction market</h2>
      <p style={{ color: "#a1a1aa", marginBottom: 16 }}>
        Yes/No markets on AI blackjack performance. Settles at end of day: Yes pays if the condition is true, No pays if false.
      </p>

      <div style={{ marginBottom: 24 }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 10 }}>Yes/No markets (today)</strong>
        <p style={{ fontSize: "0.8rem", color: "#71717a", marginBottom: 12 }}>Format: one question per model. Pick Yes or No and amount; settles end of day from blackjack P/L.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {models.slice(0, 4).map((m) => {
            const question = `Will ${m.name} finish today with positive blackjack P/L?`;
            const resolution = "Yes = P/L &gt; $0 · No = P/L ≤ $0";
            const dir = marketSelection[m.id] ?? "outperform";
            const oddsSeries = oddsHistoryByModel[m.id] ?? [];
            const hasOdds = oddsSeries.length > 0;
            const lastOdds = hasOdds ? oddsSeries[oddsSeries.length - 1] : null;
            const pad = { left: 28, right: 8, top: 6, bottom: 20 };
            const w = 260;
            const h = 72;
            const chartW = w - pad.left - pad.right;
            const chartH = h - pad.top - pad.bottom;
            const pts = hasOdds ? oddsSeries : [{ time: new Date().toISOString(), impliedYesPct: 50, totalYesCents: 0, totalNoCents: 0 }];
            const x = (i: number) => pad.left + (i / Math.max(1, pts.length - 1)) * chartW;
            const y = (pct: number) => pad.top + (1 - pct / 100) * chartH;
            return (
              <div key={m.id} style={{ padding: 14, background: "#18181b", borderRadius: 8, border: "1px solid #3f3f46" }}>
                <div style={{ fontSize: "0.95rem", color: "#e4e4e7", marginBottom: 4 }}>{question}</div>
                <div style={{ fontSize: "0.75rem", color: "#71717a", marginBottom: 10 }}>{resolution}</div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: "0.7rem", color: "#71717a", marginBottom: 4 }}>Market odds (Yes % over time)</div>
                  <svg width={w} height={h} style={{ display: "block" }} viewBox={`0 0 ${w} ${h}`}>
                    <line x1={pad.left} y1={pad.top} x2={pad.left} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                    <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                    <line x1={pad.left} y1={y(50)} x2={w - pad.right} y2={y(50)} stroke="#52525b" strokeWidth={1} strokeDasharray="3 2" />
                    <text x={pad.left - 4} y={y(0)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">100</text>
                    <text x={pad.left - 4} y={y(50)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">50</text>
                    <text x={pad.left - 4} y={y(100)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">0</text>
                    {pts.length >= 2 && (
                      <polyline
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        points={pts.map((p, i) => `${x(i)},${y(p.impliedYesPct)}`).join(" ")}
                      />
                    )}
                    {pts.length === 1 && <circle cx={x(0)} cy={y(pts[0].impliedYesPct)} r={4} fill="#3b82f6" />}
                  </svg>
                  {lastOdds && (
                    <div style={{ fontSize: "0.75rem", color: "#a1a1aa", marginTop: 2 }}>
                      Current: <strong style={{ color: "#e4e4e7" }}>{lastOdds.impliedYesPct}% Yes</strong>
                      {" "}(${(lastOdds.totalYesCents / 100).toFixed(0)} Yes / ${(lastOdds.totalNoCents / 100).toFixed(0)} No)
                    </div>
                  )}
                  {!hasOdds && <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: 2 }}>No bets yet — market at 50%</div>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>I predict:</span>
                  <button
                    type="button"
                    onClick={() => setMarketSelection((prev) => ({ ...prev, [m.id]: "outperform" }))}
                    style={{ padding: "6px 14px", background: dir === "outperform" ? "#22c55e" : "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", fontWeight: 600, cursor: "pointer" }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarketSelection((prev) => ({ ...prev, [m.id]: "underperform" }))}
                    style={{ padding: "6px 14px", background: dir === "underperform" ? "#ef4444" : "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", fontWeight: 600, cursor: "pointer" }}
                  >
                    No
                  </button>
                  <span style={{ marginLeft: 8, fontSize: "0.85rem", color: "#a1a1aa" }}>Amount: $</span>
                  <input
                    type="number"
                    min="1"
                    value={marketAmount}
                    onChange={(e) => setMarketAmount(e.target.value)}
                    style={{ width: 72, padding: "6px 8px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}
                  />
                  <button
                    onClick={() => placeMarketBet({ modelId: m.id, period: today, direction: dir, amount: marketAmount })}
                    disabled={marketLoading || !marketAmount || parseFloat(marketAmount) < 1}
                    style={{ padding: "6px 14px", background: "#3b82f6", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: marketLoading ? "not-allowed" : "pointer" }}
                  >
                    {marketLoading ? "…" : "Place bet"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <strong style={{ fontSize: "0.9rem", display: "block", marginBottom: 10 }}>Next 3 hands</strong>
        <p style={{ fontSize: "0.8rem", color: "#71717a", marginBottom: 12 }}>Who will profit more over the next 3 hands? Settles as soon as both models have played 3 more hands.</p>
        <div style={{ padding: 14, background: "#18181b", borderRadius: 8, border: "1px solid #3f3f46" }}>
          <div style={{ fontSize: "0.95rem", color: "#e4e4e7", marginBottom: 10 }}>Who will profit more over the next 3 hands?</div>
          {next3ModelA && next3ModelB && next3ModelA !== next3ModelB && (() => {
            const series = next3OddsHistory;
            const hasOdds = series.length > 0;
            const lastOdds = hasOdds ? series[series.length - 1] : null;
            const pad = { left: 28, right: 8, top: 6, bottom: 20 };
            const w = 260;
            const h = 72;
            const chartW = w - pad.left - pad.right;
            const chartH = h - pad.top - pad.bottom;
            const pts = hasOdds ? series : [{ time: new Date().toISOString(), impliedAWinsPct: 50, totalACents: 0, totalBCents: 0 }];
            const x = (i: number) => pad.left + (i / Math.max(1, pts.length - 1)) * chartW;
            const y = (pct: number) => pad.top + (1 - pct / 100) * chartH;
            const nameA = models.find((m) => m.id === next3ModelA)?.name ?? "A";
            const nameB = models.find((m) => m.id === next3ModelB)?.name ?? "B";
            return (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: "0.7rem", color: "#71717a", marginBottom: 4 }}>Market odds ({nameA} wins % over time)</div>
                <svg width={w} height={h} style={{ display: "block" }} viewBox={`0 0 ${w} ${h}`}>
                  <line x1={pad.left} y1={pad.top} x2={pad.left} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={h - pad.bottom} x2={w - pad.right} y2={h - pad.bottom} stroke="#3f3f46" strokeWidth={1} />
                  <line x1={pad.left} y1={y(50)} x2={w - pad.right} y2={y(50)} stroke="#52525b" strokeWidth={1} strokeDasharray="3 2" />
                  <text x={pad.left - 4} y={y(0)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">100</text>
                  <text x={pad.left - 4} y={y(50)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">50</text>
                  <text x={pad.left - 4} y={y(100)} textAnchor="end" dominantBaseline="middle" fill="#71717a" fontSize="8">0</text>
                  {pts.length >= 2 && (
                    <polyline fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts.map((p, i) => `${x(i)},${y(p.impliedAWinsPct)}`).join(" ")} />
                  )}
                  {pts.length === 1 && <circle cx={x(0)} cy={y(pts[0].impliedAWinsPct)} r={4} fill="#3b82f6" />}
                </svg>
                {lastOdds && (
                  <div style={{ fontSize: "0.75rem", color: "#a1a1aa", marginTop: 2 }}>
                    Current: <strong style={{ color: "#e4e4e7" }}>{lastOdds.impliedAWinsPct}% {nameA}</strong>
                    {" "}(${(lastOdds.totalACents / 100).toFixed(0)} {nameA} / ${(lastOdds.totalBCents / 100).toFixed(0)} {nameB})
                  </div>
                )}
                {!hasOdds && <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: 2 }}>No bets yet — market at 50%</div>}
              </div>
            );
          })()}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Model A</span>
            <select value={next3ModelA} onChange={(e) => setNext3ModelA(e.target.value)} style={{ padding: "6px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>vs Model B</span>
            <select value={next3ModelB} onChange={(e) => setNext3ModelB(e.target.value)} style={{ padding: "6px 10px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <span style={{ marginLeft: 8, fontSize: "0.85rem", color: "#a1a1aa" }}>I pick:</span>
            <button type="button" onClick={() => setNext3Direction("a_wins")} style={{ padding: "6px 14px", background: next3Direction === "a_wins" ? "#22c55e" : "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", fontWeight: 600, cursor: "pointer" }}>A wins</button>
            <button type="button" onClick={() => setNext3Direction("b_wins")} style={{ padding: "6px 14px", background: next3Direction === "b_wins" ? "#22c55e" : "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7", fontWeight: 600, cursor: "pointer" }}>B wins</button>
            <span style={{ fontSize: "0.85rem", color: "#a1a1aa" }}>Amount: $</span>
            <input type="number" min="1" value={marketAmount} onChange={(e) => setMarketAmount(e.target.value)} style={{ width: 72, padding: "6px 8px", background: "#27272a", border: "1px solid #3f3f46", borderRadius: 6, color: "#e4e4e7" }} />
            <button onClick={placeNext3Bet} disabled={next3Loading || next3ModelA === next3ModelB || !marketAmount || parseFloat(marketAmount) < 1} style={{ padding: "6px 14px", background: "#3b82f6", border: "none", borderRadius: 6, color: "#fff", fontWeight: 600, cursor: next3Loading ? "not-allowed" : "pointer" }}>
              {next3Loading ? "…" : "Place bet"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: 16, background: "#18181b", borderRadius: 8, border: "1px solid #3f3f46" }}>
        <strong style={{ fontSize: "0.9rem" }}>Your performance bets</strong>
        <p style={{ fontSize: "0.8rem", color: "#71717a", marginTop: 4, marginBottom: 8 }}>Day bet: Yes/No on positive P/L. Next 3: who profits more over next 3 hands.</p>
        <ul style={{ marginTop: 8, paddingLeft: 20 }}>
          {marketBets.length === 0 && next3Bets.length === 0 && <li style={{ color: "#71717a" }}>No bets yet</li>}
          {marketBets.map((b) => {
            const name = models.find((m) => m.id === b.model_id)?.name ?? b.model_id;
            const question = `Will ${name} finish ${b.period} with positive blackjack P/L?`;
            const side = b.direction === "outperform" ? "Yes" : "No";
            const outcomeColor = b.outcome === "win" ? "#22c55e" : b.outcome === "loss" ? "#ef4444" : "#a1a1aa";
            return (
              <li key={b.id} style={{ marginBottom: 10, padding: "8px 10px", background: "#27272a", borderRadius: 6, border: "1px solid #3f3f46" }}>
                <div style={{ fontSize: "0.85rem", color: "#e4e4e7" }}>{question}</div>
                <div style={{ fontSize: "0.8rem", color: "#a1a1aa", marginTop: 4 }}>
                  {side} · ${(b.amount_cents / 100).toFixed(2)} —{" "}
                  {b.outcome === "win" && b.payout_cents != null ? (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>Won ${((b.payout_cents - b.amount_cents) / 100).toFixed(2)}</span>
                  ) : b.outcome === "loss" ? (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>Lost ${(b.amount_cents / 100).toFixed(2)}</span>
                  ) : (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>{b.outcome}</span>
                  )}
                </div>
              </li>
            );
          })}
          {next3Bets.map((b) => {
            const nameA = models.find((m) => m.id === b.model_a_id)?.name ?? b.model_a_id;
            const nameB = models.find((m) => m.id === b.model_b_id)?.name ?? b.model_b_id;
            const pick = b.direction === "a_wins" ? `${nameA} wins` : `${nameB} wins`;
            const outcomeColor = b.outcome === "win" ? "#22c55e" : b.outcome === "loss" ? "#ef4444" : "#a1a1aa";
            return (
              <li key={b.id} style={{ marginBottom: 10, padding: "8px 10px", background: "#27272a", borderRadius: 6, border: "1px solid #3f3f46" }}>
                <div style={{ fontSize: "0.85rem", color: "#e4e4e7" }}>Next 3 hands: {nameA} vs {nameB}</div>
                <div style={{ fontSize: "0.8rem", color: "#a1a1aa", marginTop: 4 }}>
                  {pick} · ${(b.amount_cents / 100).toFixed(2)} —{" "}
                  {b.outcome === "win" && b.payout_cents != null ? (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>Won ${((b.payout_cents - b.amount_cents) / 100).toFixed(2)}</span>
                  ) : b.outcome === "push" && b.payout_cents != null && b.payout_cents > 0 ? (
                    <span style={{ color: "#a1a1aa", fontWeight: 600 }}>Refunded ${(b.payout_cents / 100).toFixed(2)}</span>
                  ) : b.outcome === "loss" ? (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>Lost ${(b.amount_cents / 100).toFixed(2)}</span>
                  ) : (
                    <span style={{ color: outcomeColor, fontWeight: 600 }}>{b.outcome}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
      )}

      {activeTab === "crop" && (
        <CropBenchmarkSection API={API} onBalanceChange={fetchUserBalance} />
      )}
    </div>
  );
}
