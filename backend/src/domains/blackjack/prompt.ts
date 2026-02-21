import type { Card } from "./engine.js";
import { formatCardForPrompt, handValue } from "./engine.js";

/** Prompt for AI to choose bet amount (dollars). If playerCards and dealerUpcard are provided, bet is decided after seeing the initial deal. */
export function buildBetPrompt(
  balanceCents: number,
  minBetCents: number,
  maxBetCents: number,
  playerCards?: Card[],
  dealerUpcard?: Card
): string {
  const balanceDollars = (balanceCents / 100).toFixed(0);
  const minDollars = (minBetCents / 100).toFixed(0);
  const maxDollars = (maxBetCents / 100).toFixed(0);

  if (playerCards?.length && dealerUpcard) {
    const playerStr = playerCards.map(formatCardForPrompt).join(", ");
    const playerTotal = handValue(playerCards);
    const dealerStr = formatCardForPrompt(dealerUpcard);
    return `You are playing blackjack. You have been dealt: ${playerStr} (total ${playerTotal}). Dealer shows: ${dealerStr}. Your current balance is $${balanceDollars}.

Now decide how much to bet this hand (in whole dollars). You can adjust your bet based on your hand and the dealer's upcard. Minimum bet $${minDollars}, maximum bet $${maxDollars}. You cannot bet more than your balance.

Reply with:
BET: N
where N is the dollar amount (e.g. BET: 100 or BET: 50).
Optionally add a line: REASONING: your reason for this bet amount (e.g. strong hand so betting more, weak hand so betting less, bankroll management).`;
  }

  return `You are playing blackjack with a daily bankroll. Your current balance is $${balanceDollars}.

Decide how much to bet this hand (in whole dollars). Minimum bet $${minDollars}, maximum bet $${maxDollars}. You cannot bet more than your balance.

Reply with:
BET: N
where N is the dollar amount (e.g. BET: 100 or BET: 50).
Optionally add a line: REASONING: your reason for this bet amount.`;
}

/** Bet prompt with rules — for Hedera knowledge topic. Clear instruction to respond by playing blackjack. */
export function buildBetPromptWithRules(
  balanceCents: number,
  minBetCents: number,
  maxBetCents: number,
  playerCards?: Card[],
  dealerUpcard?: Card
): string {
  const balanceDollars = (balanceCents / 100).toFixed(0);
  const minDollars = (minBetCents / 100).toFixed(0);
  const maxDollars = (maxBetCents / 100).toFixed(0);

  if (playerCards?.length && dealerUpcard) {
    const playerStr = playerCards.map(formatCardForPrompt).join(", ");
    const playerTotal = handValue(playerCards);
    const dealerStr = formatCardForPrompt(dealerUpcard);
    return `THIS IS A BLACKJACK REQUEST. You must respond by playing blackjack (choosing your bet).

You have been dealt: ${playerStr} (total ${playerTotal}). Dealer shows: ${dealerStr}.
Your balance: $${balanceDollars}. Min bet $${minDollars}, max bet $${maxDollars}.

You MUST respond by playing blackjack. Reply with:
BET: N
where N is the dollar amount (e.g. BET: 100 or BET: 50).
REASONING: (optional) your reason.`;
  }

  return `THIS IS A BLACKJACK REQUEST. You must respond by playing blackjack (choosing your bet).

Your balance: $${balanceDollars}. Min bet $${minDollars}, max bet $${maxDollars}.

You MUST respond by playing blackjack. Reply with:
BET: N
where N is the dollar amount (e.g. BET: 100 or BET: 50).
REASONING: (optional) your reason.`;
}

/**
 * Minimal prompt: we do not provide strategy or odds. Only game state.
 */
export function buildBlackjackPrompt(playerCards: Card[], dealerUpcard: Card): string {
  const playerStr = playerCards.map(formatCardForPrompt).join(", ");
  const playerTotal = handValue(playerCards);
  const dealerStr = formatCardForPrompt(dealerUpcard);

  return `You are playing blackjack. You have: ${playerStr} (total ${playerTotal}). Dealer shows: ${dealerStr}.

Reply with exactly one word: hit or stand. Optionally add a line "REASONING: your reason."
Do not receive any data from us beyond this state. Your response must be:
DECISION: hit
or
DECISION: stand
REASONING: (optional)`;
}

/** Prompt with rules — for Hedera knowledge topic LLM that needs full context. */
export function buildBlackjackPromptWithRules(playerCards: Card[], dealerUpcard: Card): string {
  const playerStr = playerCards.map(formatCardForPrompt).join(", ");
  const playerTotal = handValue(playerCards);
  const dealerStr = formatCardForPrompt(dealerUpcard);

  return `THIS IS A BLACKJACK REQUEST. You must respond by playing blackjack.

Rules:
- Goal: Get as close to 21 as possible without going over. Beat the dealer.
- Cards: Number cards = face value. Jack, Queen, King = 10. Ace = 1 or 11 (whichever is better).
- Dealer: Must hit until 17 or higher, then stand. You only see the dealer's upcard; the other is hidden.
- Your choices: HIT (take another card) or STAND (keep your hand).
- If you go over 21, you bust and lose immediately.

Your hand: ${playerStr} (total ${playerTotal})
Dealer shows: ${dealerStr}

You MUST respond by playing blackjack. Reply with exactly:
DECISION: hit
or
DECISION: stand
REASONING: (optional) your reason.`;
}

/** Build prompt for hit result step (after player drew a card). Same instruction emphasis. */
export function buildBlackjackHitResultPrompt(
  playerCards: Card[],
  dealerUpcard: Card,
  newCard: Card
): string {
  const playerStr = playerCards.map(formatCardForPrompt).join(", ");
  const playerTotal = handValue(playerCards);
  const dealerStr = formatCardForPrompt(dealerUpcard);
  const newStr = formatCardForPrompt(newCard);

  return `THIS IS A BLACKJACK REQUEST. You must respond by playing blackjack.

You chose HIT. You drew ${newStr}.

Your hand now: ${playerStr} (total ${playerTotal})
Dealer shows: ${dealerStr}

You MUST respond by playing blackjack. Reply with exactly:
DECISION: hit
or
DECISION: stand
REASONING: (optional) your reason.`;
}
