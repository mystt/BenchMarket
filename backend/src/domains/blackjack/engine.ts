/**
 * Blackjack engine: deck, hand value, dealer behavior.
 * We do not send strategy or odds to the AI — only minimal game state.
 */

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export const SUITS = ["H", "D", "C", "S"] as const;
export type Card = `${(typeof RANKS)[number]}${(typeof SUITS)[number]}`;

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);
  return shuffle(deck);
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardValue(card: Card): number {
  const rank = card.slice(0, -1);
  if (rank === "A") return 11;
  if (["K", "Q", "J"].includes(rank)) return 10;
  return parseInt(rank, 10);
}

export function handValue(cards: Card[]): number {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter((c) => c.startsWith("A")).length;
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/** Dealer plays: hit until 17+ */
export function dealerPlays(deck: Card[], hand: Card[]): Card[] {
  const h = [...hand];
  while (handValue(h) < 17) h.push(deck.pop()!);
  return h;
}

/** Resolve player hand vs dealer hand. Returns 'win' | 'loss' | 'push' */
export function resolveHand(
  playerCards: Card[],
  dealerCards: Card[]
): "win" | "loss" | "push" {
  const pv = handValue(playerCards);
  const dv = handValue(dealerCards);
  if (pv > 21) return "loss";
  if (dv > 21) return "win";
  if (pv > dv) return "win";
  if (pv < dv) return "loss";
  return "push";
}

export function formatCardForPrompt(card: Card): string {
  const r = card.slice(0, -1);
  const s = card.slice(-1);
  const suit = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" }[s];
  return `${r} of ${suit}`;
}
