# Blackjack Reference Guide

## Game Rules
- Goal: Get as close to 21 as possible without going over. Beat the dealer.
- Number cards (2-10) = face value. Jack, Queen, King = 10. Ace = 1 or 11 (whichever is better for your hand).
- Dealer must hit until 17 or higher, then stand. You only see the dealer's upcard; the hole card is hidden.
- Your choices: HIT (take another card) or STAND (keep your hand).
- If you go over 21, you bust and lose immediately.
- Blackjack (Ace + 10-value) pays 3:2. Push = tie, bet returned.

## Win Probability by Hand (Approximate % to Win)
Use these when deciding bet size and hit/stand. Dealer upcard strongly affects odds.

| Your Total | vs Dealer 2-6 | vs Dealer 7 | vs Dealer 8 | vs Dealer 9 | vs Dealer 10/A |
|------------|---------------|-------------|-------------|-------------|----------------|
| 21 (any)   | ~95%+         | ~95%+       | ~95%+       | ~95%+       | ~85–95%        |
| Blackjack  | 100%          | 100%        | 100%        | 100%        | 100%           |
| 20         | ~92%          | ~87%        | ~82%        | ~77%        | ~71%           |
| 19         | ~88%          | ~83%        | ~77%        | ~72%        | ~66%           |
| 18         | ~83%          | ~76%        | ~70%        | ~64%        | ~58%           |
| 17         | ~77%          | ~68%        | ~61%        | ~55%        | ~48%           |
| 16         | ~62%          | ~47%        | ~41%        | ~35%        | ~29%           |
| 15         | ~58%          | ~42%        | ~36%        | ~30%        | ~24%           |
| 12–14      | ~45–55%       | ~35–45%     | ~30–40%     | ~25–35%     | ~20–30%        |
| 11 or less | ~25–40%       | ~25–40%     | ~25–40%     | ~25–40%     | ~25–40%        |

Note: Blackjack (A+10) cannot lose. At worst, dealer also has blackjack → push. Win% is 100% or push.

## Betting: You See Cards Before Betting — Adjust Strategy
You see your hand and the dealer’s upcard before betting. Use that information.

**Guaranteed no loss (bet max or entire bankroll):**
- **Blackjack (A+10):** You will win or push. Never lose. Bet your entire balance.
- **21 (three or more cards):** Same — you win or push. Bet your entire balance.

**Strong hands (bet high):**
- 20 vs dealer 2–9: ~77–92% win. Bet 50–100% of balance.
- 19 vs dealer 2–7: ~77–88% win. Bet 40–80% of balance.
- 18 vs dealer 2–6: ~77–83% win. Bet 30–70% of balance.

**Medium hands (bet modest):**
- 17: ~48–77% win depending on dealer. Bet 20–50%.
- 16 vs dealer 2–6: ~47–62%. Bet 15–40%.

**Weak hands (bet small):**
- 12–16 vs dealer 7+: ~24–47% win. Bet minimum to limit loss.
- 11 or less: Still drawing. Bet minimum.

## Basic Strategy Hints
- Stand on 17+. Stand on 12-16 vs dealer 2-6. Hit 12-16 vs dealer 7+.
- Always hit 11 or less.
- Soft 18 (A+7): stand vs 2, 7, 8; hit vs 9, 10, A.
- Pair splitting: split Aces and 8s. Never split 10s or 5s.

## Response Format
**When betting**, reply with:
BET: N
REASONING: (optional) Your reason (e.g., "Blackjack — guaranteed win or push, betting full balance").

**When hitting or standing**, reply with:
DECISION: hit
or
DECISION: stand
REASONING: Your brief reason (e.g., "Dealer shows 6, standing on 16 gives good chance dealer busts").
