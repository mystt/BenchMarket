import { randomUUID } from "crypto";
import { query } from "../../db/client.js";
import { config } from "../../config.js";
import { getAIProvider, type AIProvider } from "../../ai/index.js";
import {
  createDeck,
  handValue,
  isBust,
  dealerPlays,
  resolveHand,
  type Card,
} from "./engine.js";
import { buildBlackjackPrompt, buildBetPrompt } from "./prompt.js";
import { submitAiResult } from "../../hedera/hcs.js";

const BLACKJACK_DAILY_CENTS = config.blackjackDailyCents;
const MIN_BET_CENTS = config.blackjackMinBetCents;
const MAX_BET_CENTS = config.blackjackMaxBetCents;

/** Parse BET: N or BET: $N from AI response; return cents or null. */
function parseBetFromResponse(text: string): number | null {
  const match = text.match(/BET:\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const dollars = parseFloat(match[1]);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

type DateString = string; // YYYY-MM-DD

function today(): DateString {
  return new Date().toISOString().slice(0, 10);
}

/** Ensure AI model exists in ai_models (for FK). */
export async function ensureAIModel(modelId: string, name: string): Promise<void> {
  await query(
    `INSERT INTO ai_models (id, name, provider) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [modelId, name, modelId.split("-")[0] ?? "unknown"]
  );
}

/** Get or create daily bankroll for model. Reset to 100k at start of day. */
export async function getOrCreateDailyBankroll(
  modelId: string,
  domain: "blackjack",
  date: DateString
): Promise<number> {
  const id = randomUUID();
  const res = await query<{ balance_cents: number }>(
    `INSERT INTO daily_bankrolls (id, model_id, domain, date, balance_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (model_id, domain, date) DO UPDATE SET updated_at = NOW()
     RETURNING balance_cents`,
    [id, modelId, domain, date, BLACKJACK_DAILY_CENTS]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Failed to get bankroll");
  return Number(row.balance_cents);
}

/** Deduct bet from daily bankroll; return new balance. */
export async function deductBet(
  modelId: string,
  date: DateString,
  betCents: number
): Promise<number> {
  const res = await query<{ balance_cents: number }>(
    `UPDATE daily_bankrolls
     SET balance_cents = balance_cents - $3, updated_at = NOW()
     WHERE model_id = $1 AND domain = 'blackjack' AND date = $2 AND balance_cents >= $3
     RETURNING balance_cents`,
    [modelId, date, betCents]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Insufficient bankroll or no row");
  return row.balance_cents;
}

/** Credit winnings (or refund push). */
export async function creditResult(
  modelId: string,
  date: DateString,
  pnlCents: number
): Promise<void> {
  await query(
    `UPDATE daily_bankrolls
     SET balance_cents = balance_cents + $3, updated_at = NOW()
     WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`,
    [modelId, date, pnlCents]
  );
}

/** Ask AI how much to bet this hand; returns clamped bet in cents. */
export async function getAIBetCents(modelId: string): Promise<number> {
  const date = today();
  const provider = getAIProvider(modelId);
  if (!provider) throw new Error(`Unknown AI model: ${modelId}`);
  await ensureAIModel(provider.id, provider.name);
  const balance = await getOrCreateDailyBankroll(modelId, "blackjack", date);
  const handMaxBet = Math.min(balance, MAX_BET_CENTS);
  if (balance < MIN_BET_CENTS) throw new Error("Insufficient bankroll");
  const betPrompt = buildBetPrompt(balance, MIN_BET_CENTS, handMaxBet);
  const betResponse = await provider.ask(betPrompt);
  const textToParse = betResponse.raw ?? [betResponse.decision, betResponse.reasoning].filter(Boolean).join(" ");
  const raw = parseBetFromResponse(textToParse);
  return raw != null ? Math.max(MIN_BET_CENTS, Math.min(handMaxBet, raw)) : MIN_BET_CENTS;
}

/** Play one hand: ask AI, resolve, log, update bankroll. */
export async function playHand(
  modelId: string,
  betCents: number
): Promise<{
  handId: string;
  playerCards: Card[];
  dealerCards: Card[];
  playerTotal: number;
  dealerTotal: number;
  decision: string;
  reasoning: string | null;
  outcome: "win" | "loss" | "push";
  pnlCents: number;
  balanceCentsAfter: number;
}> {
  const date = today();
  const provider = getAIProvider(modelId);
  if (!provider) throw new Error(`Unknown AI model: ${modelId}`);
  await ensureAIModel(provider.id, provider.name);

  const balance = await getOrCreateDailyBankroll(modelId, "blackjack", date);
  if (balance < betCents) throw new Error("Insufficient bankroll for this bet");

  const deck = createDeck();
  const playerCards: Card[] = [deck.pop()!, deck.pop()!];
  const dealerUpcard = deck.pop()!;
  const dealerDown = deck.pop()!;

  const prompt = buildBlackjackPrompt(playerCards, dealerUpcard);
  const { decision, reasoning } = await provider.ask(prompt);

  const normalizedDecision = decision.toLowerCase().startsWith("hit") ? "hit" : "stand";

  if (normalizedDecision === "hit") {
    playerCards.push(deck.pop()!);
  }
  // else stand

  const dealerCards = [dealerUpcard, dealerDown];
  if (!isBust(playerCards)) {
    const dealerFinal = dealerPlays(deck, dealerCards);
    dealerCards.length = 0;
    dealerCards.push(...dealerFinal);
  }

  const outcome = isBust(playerCards)
    ? "loss"
    : resolveHand(playerCards, dealerCards);
  const pnlCents =
    outcome === "win"
      ? betCents
      : outcome === "loss"
        ? -betCents
        : 0;

  await deductBet(modelId, date, betCents);
  await creditResult(modelId, date, pnlCents);

  const handId = randomUUID();
  await query(
    `INSERT INTO blackjack_hands (id, model_id, date, bet_cents, player_cards, dealer_upcard, decision, reasoning, outcome, pnl_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      handId,
      modelId,
      date,
      betCents,
      JSON.stringify(playerCards),
      dealerUpcard,
      normalizedDecision,
      reasoning ?? null,
      outcome,
      pnlCents,
    ]
  );

  const balanceRes = await query<{ balance_cents: number }>(
    `SELECT balance_cents FROM daily_bankrolls WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`,
    [modelId, date]
  );
  const balanceCentsAfter = Number(balanceRes.rows[0]?.balance_cents ?? balance - betCents + pnlCents);

  return {
    handId,
    playerCards,
    dealerCards,
    playerTotal: handValue(playerCards),
    dealerTotal: handValue(dealerCards),
    decision: normalizedDecision,
    reasoning: reasoning ?? null,
    outcome,
    pnlCents: Number(pnlCents),
    balanceCentsAfter,
  };
}

/** Stream event types for live casino-style playback */
export type StreamEvent =
  | { type: "hand_start"; handIndex: number; totalHands: number }
  | { type: "bet"; betCents: number; reasoning: string | null }
  | { type: "deal"; playerCards: Card[]; playerTotal: number; dealerUpcard: Card }
  | { type: "reasoning_chunk"; text: string }
  | { type: "decision"; decision: string; reasoning: string | null }
  | { type: "player_card"; card: Card; playerCards: Card[]; playerTotal: number }
  | { type: "dealer_reveal"; dealerCards: Card[]; dealerTotal: number }
  | { type: "dealer_draw"; card: Card; dealerCards: Card[]; dealerTotal: number }
  | { type: "outcome"; outcome: "win" | "loss" | "push"; pnlCents: number; balanceCentsAfter: number }
  | { type: "hand_end"; handIndex: number }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Play N hands with step-by-step events (deal → reasoning → decision → cards → outcome).
 * Supports multiple hits per hand (re-ask AI until stand or bust). Emits events for live UI.
 */
export async function playHandsStream(
  modelId: string,
  maxBetCents: number,
  hands: number,
  onEvent: (ev: StreamEvent) => void
): Promise<void> {
  const date = today();
  const provider = getAIProvider(modelId);
  if (!provider) {
    onEvent({ type: "error", message: `Unknown AI model: ${modelId}` });
    return;
  }
  await ensureAIModel(provider.id, provider.name);

  let balance = await getOrCreateDailyBankroll(modelId, "blackjack", date);
  const totalHands = Math.max(1, Math.min(hands, 100));
  const askStream = provider.askStream?.bind(provider);
  const effectiveMaxBet = maxBetCents > 0 ? Math.min(maxBetCents, MAX_BET_CENTS) : MAX_BET_CENTS;

  for (let handIndex = 0; handIndex < totalHands; handIndex++) {
    const minBet = MIN_BET_CENTS;
    const handMaxBet = Math.min(balance, effectiveMaxBet);
    if (balance < minBet) {
      onEvent({ type: "error", message: "Insufficient bankroll" });
      break;
    }
    onEvent({ type: "hand_start", handIndex: handIndex + 1, totalHands });

    // Deal first so the AI can see their cards before betting
    const deck = createDeck();
    const playerCards: Card[] = [deck.pop()!, deck.pop()!];
    const dealerUpcard = deck.pop()!;
    const dealerDown = deck.pop()!;
    onEvent({ type: "deal", playerCards: [...playerCards], playerTotal: handValue(playerCards), dealerUpcard });

    // AI decides how much to bet after seeing the initial deal
    const betPrompt = buildBetPrompt(balance, minBet, handMaxBet, playerCards, dealerUpcard);
    const betResponse = await provider.ask(betPrompt);
    const textToParse = betResponse.raw ?? [betResponse.decision, betResponse.reasoning].filter(Boolean).join(" ");
    const rawBetCents = parseBetFromResponse(textToParse);
    const betCents = rawBetCents != null
      ? Math.max(minBet, Math.min(handMaxBet, rawBetCents))
      : minBet;
    onEvent({ type: "bet", betCents, reasoning: betResponse.reasoning ?? null });

    let lastDecision = "stand";
    let lastReasoning: string | null = null;
    let reasoningAccum = "";

    // Player turn: hit or stand (multiple hits until stand or bust)
    while (true) {
      const prompt = buildBlackjackPrompt(playerCards, dealerUpcard);
      if (askStream) {
        lastReasoning = null;
        reasoningAccum = "";
        let result: { decision: string; reasoning?: string };
        const gen = askStream(prompt);
        let next = await gen.next();
        while (!next.done) {
          const chunk = next.value as string;
          reasoningAccum += chunk;
          onEvent({ type: "reasoning_chunk", text: chunk });
          next = await gen.next();
        }
        result = next.value as { decision: string; reasoning?: string };
        lastDecision = result.decision.toLowerCase().startsWith("hit") ? "hit" : "stand";
        lastReasoning = result.reasoning ?? (reasoningAccum.trim() || null);
      } else {
        const res = await provider.ask(prompt);
        lastDecision = res.decision.toLowerCase().startsWith("hit") ? "hit" : "stand";
        lastReasoning = res.reasoning ?? null;
      }
      onEvent({ type: "decision", decision: lastDecision, reasoning: lastReasoning });

      if (lastDecision !== "hit") break;
      const newCard = deck.pop()!;
      playerCards.push(newCard);
      onEvent({
        type: "player_card",
        card: newCard,
        playerCards: [...playerCards],
        playerTotal: handValue(playerCards),
      });
      if (isBust(playerCards)) break;
    }

    // Dealer turn
    const dealerCards: Card[] = [dealerUpcard, dealerDown];
    onEvent({ type: "dealer_reveal", dealerCards: [...dealerCards], dealerTotal: handValue(dealerCards) });
    while (handValue(dealerCards) < 17) {
      const card = deck.pop()!;
      dealerCards.push(card);
      onEvent({ type: "dealer_draw", card, dealerCards: [...dealerCards], dealerTotal: handValue(dealerCards) });
    }

    const outcome = isBust(playerCards) ? "loss" : resolveHand(playerCards, dealerCards);
    const pnlCents = outcome === "win" ? betCents : outcome === "loss" ? -betCents : 0;
    await deductBet(modelId, date, betCents);
    await creditResult(modelId, date, pnlCents);
    balance = balance - betCents + pnlCents;
    const balanceRes = await query<{ balance_cents: number }>(
      `SELECT balance_cents FROM daily_bankrolls WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`,
      [modelId, date]
    );
    const balanceCentsAfter = Number(balanceRes.rows[0]?.balance_cents ?? balance);

    const handId = randomUUID();
    await query(
      `INSERT INTO blackjack_hands (id, model_id, date, bet_cents, player_cards, dealer_upcard, decision, reasoning, outcome, pnl_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        handId,
        modelId,
        date,
        betCents,
        JSON.stringify(playerCards),
        dealerUpcard,
        lastDecision,
        lastReasoning,
        outcome,
        pnlCents,
      ]
    );

    submitAiResult({
      domain: "blackjack",
      handId,
      modelId,
      date,
      betCents,
      outcome,
      pnlCents,
      playerCards: [...playerCards],
      dealerUpcard,
      decision: lastDecision,
    }).catch(() => {});

    onEvent({ type: "outcome", outcome, pnlCents, balanceCentsAfter });
    onEvent({ type: "hand_end", handIndex: handIndex + 1 });
  }
  onEvent({ type: "done" });
}

/** VS mode: events for two AIs at the same table */
export type StreamEventVs =
  | { type: "hand_start"; handIndex: number; totalHands: number }
  | { type: "deal_vs"; playerACards: Card[]; playerATotal: number; playerBCards: Card[]; playerBTotal: number; dealerUpcard: Card }
  | { type: "bet"; player: "a" | "b"; betCents: number; reasoning: string | null }
  | { type: "reasoning_chunk"; player: "a" | "b"; text: string }
  | { type: "decision"; player: "a" | "b"; decision: string; reasoning: string | null }
  | { type: "player_card"; player: "a" | "b"; card: Card; playerCards: Card[]; playerTotal: number }
  | { type: "dealer_reveal"; dealerCards: Card[]; dealerTotal: number }
  | { type: "dealer_draw"; card: Card; dealerCards: Card[]; dealerTotal: number }
  | { type: "outcome_vs"; playerA: { outcome: "win" | "loss" | "push"; pnlCents: number; balanceCentsAfter: number }; playerB: { outcome: "win" | "loss" | "push"; pnlCents: number; balanceCentsAfter: number } }
  | { type: "hand_end"; handIndex: number }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Two AIs at the same table: same dealer, each has own hand and bankroll. Deal → each bets (after seeing cards) → A plays → B plays → dealer → resolve both.
 */
export async function playHandsStreamVs(
  modelIdA: string,
  modelIdB: string,
  maxBetCents: number,
  hands: number,
  onEvent: (ev: StreamEventVs) => void
): Promise<void> {
  const date = today();
  const providerA = getAIProvider(modelIdA);
  const providerB = getAIProvider(modelIdB);
  if (!providerA || !providerB) {
    onEvent({ type: "error", message: `Unknown model: ${!providerA ? modelIdA : modelIdB}` });
    return;
  }
  await ensureAIModel(providerA.id, providerA.name);
  await ensureAIModel(providerB.id, providerB.name);

  let balanceA = await getOrCreateDailyBankroll(modelIdA, "blackjack", date);
  let balanceB = await getOrCreateDailyBankroll(modelIdB, "blackjack", date);
  const totalHands = Math.max(1, Math.min(hands, 100));
  const effectiveMaxBet = maxBetCents > 0 ? Math.min(maxBetCents, MAX_BET_CENTS) : MAX_BET_CENTS;

  for (let handIndex = 0; handIndex < totalHands; handIndex++) {
    const minBet = MIN_BET_CENTS;
    const maxA = Math.min(balanceA, effectiveMaxBet);
    const maxB = Math.min(balanceB, effectiveMaxBet);
    if (balanceA < minBet || balanceB < minBet) {
      onEvent({ type: "error", message: "Insufficient bankroll" });
      break;
    }
    onEvent({ type: "hand_start", handIndex: handIndex + 1, totalHands });

    const deck = createDeck();
    const playerACards: Card[] = [deck.pop()!, deck.pop()!];
    const playerBCards: Card[] = [deck.pop()!, deck.pop()!];
    const dealerUpcard = deck.pop()!;
    const dealerDown = deck.pop()!;
    onEvent({
      type: "deal_vs",
      playerACards: [...playerACards],
      playerATotal: handValue(playerACards),
      playerBCards: [...playerBCards],
      playerBTotal: handValue(playerBCards),
      dealerUpcard,
    });

    const askBet = async (modelId: string, provider: { ask: (p: string) => Promise<{ reasoning?: string; raw?: string; decision: string }> }, balance: number, playerCards: Card[], up: Card): Promise<{ betCents: number; reasoning: string | null }> => {
      const handMaxBet = Math.min(balance, effectiveMaxBet);
      const betPrompt = buildBetPrompt(balance, minBet, handMaxBet, playerCards, up);
      const res = await provider.ask(betPrompt);
      const text = res.raw ?? [res.decision, res.reasoning].filter(Boolean).join(" ");
      const raw = parseBetFromResponse(text);
      const betCents = raw != null ? Math.max(minBet, Math.min(handMaxBet, raw)) : minBet;
      return { betCents, reasoning: res.reasoning ?? null };
    };

    const betA = await askBet(modelIdA, providerA, balanceA, playerACards, dealerUpcard);
    onEvent({ type: "bet", player: "a", betCents: betA.betCents, reasoning: betA.reasoning });
    const betB = await askBet(modelIdB, providerB, balanceB, playerBCards, dealerUpcard);
    onEvent({ type: "bet", player: "b", betCents: betB.betCents, reasoning: betB.reasoning });

    const playTurn = async (
      player: "a" | "b",
      provider: AIProvider,
      playerCards: Card[],
      onEv: (ev: StreamEventVs) => void
    ): Promise<{ cards: Card[]; lastDecision: string; lastReasoning: string | null }> => {
      const cards = [...playerCards];
      let lastDecision = "stand";
      let lastReasoning: string | null = null;
      const askStream = provider.askStream?.bind(provider);
      while (true) {
        const prompt = buildBlackjackPrompt(cards, dealerUpcard);
        if (askStream) {
          let reasoningAccum = "";
          const gen = askStream(prompt);
          let next = await gen.next();
          while (!next.done) {
            const chunk = next.value as string;
            reasoningAccum += chunk;
            onEv({ type: "reasoning_chunk", player, text: chunk });
            next = await gen.next();
          }
          const result = next.value as { decision: string; reasoning?: string };
          lastDecision = result.decision.toLowerCase().startsWith("hit") ? "hit" : "stand";
          lastReasoning = result.reasoning ?? (reasoningAccum.trim() || null);
        } else {
          const res = await provider.ask(prompt);
          lastDecision = res.decision.toLowerCase().startsWith("hit") ? "hit" : "stand";
          lastReasoning = res.reasoning ?? null;
        }
        onEv({ type: "decision", player, decision: lastDecision, reasoning: lastReasoning });
        if (lastDecision !== "hit") break;
        const newCard = deck.pop()!;
        cards.push(newCard);
        onEv({ type: "player_card", player, card: newCard, playerCards: [...cards], playerTotal: handValue(cards) });
        if (isBust(cards)) break;
      }
      return { cards, lastDecision, lastReasoning };
    };

    const resultA = await playTurn("a", providerA, playerACards, onEvent);
    const resultB = await playTurn("b", providerB, playerBCards, onEvent);

    const dealerCards: Card[] = [dealerUpcard, dealerDown];
    onEvent({ type: "dealer_reveal", dealerCards: [...dealerCards], dealerTotal: handValue(dealerCards) });
    while (handValue(dealerCards) < 17) {
      const card = deck.pop()!;
      dealerCards.push(card);
      onEvent({ type: "dealer_draw", card, dealerCards: [...dealerCards], dealerTotal: handValue(dealerCards) });
    }

    const outcomeA = isBust(resultA.cards) ? "loss" : resolveHand(resultA.cards, dealerCards);
    const outcomeB = isBust(resultB.cards) ? "loss" : resolveHand(resultB.cards, dealerCards);
    const pnlA = outcomeA === "win" ? betA.betCents : outcomeA === "loss" ? -betA.betCents : 0;
    const pnlB = outcomeB === "win" ? betB.betCents : outcomeB === "loss" ? -betB.betCents : 0;

    await deductBet(modelIdA, date, betA.betCents);
    await creditResult(modelIdA, date, pnlA);
    await deductBet(modelIdB, date, betB.betCents);
    await creditResult(modelIdB, date, pnlB);
    balanceA = balanceA - betA.betCents + pnlA;
    balanceB = balanceB - betB.betCents + pnlB;

    const resA = await query<{ balance_cents: number }>(`SELECT balance_cents FROM daily_bankrolls WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`, [modelIdA, date]);
    const resB = await query<{ balance_cents: number }>(`SELECT balance_cents FROM daily_bankrolls WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`, [modelIdB, date]);
    const balanceCentsAfterA = Number(resA.rows[0]?.balance_cents ?? balanceA);
    const balanceCentsAfterB = Number(resB.rows[0]?.balance_cents ?? balanceB);

    const handIdA = randomUUID();
    const handIdB = randomUUID();
    await query(
      `INSERT INTO blackjack_hands (id, model_id, date, bet_cents, player_cards, dealer_upcard, decision, reasoning, outcome, pnl_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [handIdA, modelIdA, date, betA.betCents, JSON.stringify(resultA.cards), dealerUpcard, resultA.lastDecision, resultA.lastReasoning, outcomeA, pnlA]
    );
    await query(
      `INSERT INTO blackjack_hands (id, model_id, date, bet_cents, player_cards, dealer_upcard, decision, reasoning, outcome, pnl_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [handIdB, modelIdB, date, betB.betCents, JSON.stringify(resultB.cards), dealerUpcard, resultB.lastDecision, resultB.lastReasoning, outcomeB, pnlB]
    );

    submitAiResult({
      domain: "blackjack_vs",
      handIdA,
      handIdB,
      modelIdA,
      modelIdB,
      date,
      outcomeA,
      outcomeB,
      pnlA,
      pnlB,
      playerACards: resultA.cards,
      playerBCards: resultB.cards,
      dealerUpcard,
      dealerCards: dealerCards.map(String),
      dealerTotal: handValue(dealerCards),
      betA: betA.betCents,
      betB: betB.betCents,
      decisionA: resultA.lastDecision,
      decisionB: resultB.lastDecision,
    }).catch(() => {});

    onEvent({
      type: "outcome_vs",
      playerA: { outcome: outcomeA, pnlCents: pnlA, balanceCentsAfter: balanceCentsAfterA },
      playerB: { outcome: outcomeB, pnlCents: pnlB, balanceCentsAfter: balanceCentsAfterB },
    });
    onEvent({ type: "hand_end", handIndex: handIndex + 1 });
  }
  onEvent({ type: "done" });
}

export async function getBlackjackDailyState(
  modelId: string,
  date: DateString
): Promise<{ balanceCents: number; handsPlayed: number; pnlCents: number }> {
  const provider = getAIProvider(modelId);
  if (provider) await ensureAIModel(provider.id, provider.name);
  await getOrCreateDailyBankroll(modelId, "blackjack", date);
  const bankRes = await query<{ balance_cents: string }>(
    `SELECT balance_cents FROM daily_bankrolls WHERE model_id = $1 AND domain = 'blackjack' AND date = $2`,
    [modelId, date]
  );
  const balanceRow = bankRes.rows[0];
  const handsRes = await query<{ count: string; pnl: string }>(
    `SELECT COUNT(*)::text as count, COALESCE(SUM(pnl_cents), 0)::text as pnl FROM blackjack_hands WHERE model_id = $1 AND date = $2`,
    [modelId, date]
  );
  const handsRow = handsRes.rows[0];
  return {
    balanceCents: Number(balanceRow?.balance_cents ?? BLACKJACK_DAILY_CENTS),
    handsPlayed: Number(handsRow?.count ?? 0),
    pnlCents: Number(handsRow?.pnl ?? 0),
  };
}
