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
