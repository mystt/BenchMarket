# AI Benchmark Market

Market-based benchmark for AI performance: Blackjack, Sports, and Crop predictions. Built to run on **Hedera** (on-chain settlement) with a **dashboard** for placing bets on AI performance.

## MVP summary

- **No user sign-in** for MVP.
- **Blackjack:** $100k/day per AI; bet all day; reset daily.
- **Sports:** $100k/day per AI; bet on each day’s matches; reset daily.
- **Crops:** Rolling bankroll; prediction contracts (e.g. “Will 2025 US corn yield be above 175 bu/acre?”); per-day and long-term results.
- **AI:** We only ask (no data provided). Easy REST APIs (OpenAI, etc.).

## Prerequisites

- Node 18+
- **No database install required:** the app uses **SQLite** by default (file at `data/benchmark.db`). Leave `DATABASE_URL` empty or set `DATABASE_URL=sqlite` in `.env`. To use PostgreSQL instead, set `DATABASE_URL` to your Postgres connection string.
- `OPENAI_API_KEY` in `.env` for blackjack AI

## Quick start

```bash
# Install dependencies
npm install

# Copy env and set OPENAI_API_KEY if you have it
cp .env.example .env

# Create SQLite DB and tables (creates data/benchmark.db if using SQLite)
npm run db:migrate

# Start backend
npm run dev:backend

# In another terminal: start dashboard
npm run dev:frontend
```

- Backend: http://localhost:4000  
- Frontend: http://localhost:5173 (or port shown)

## Project layout

```
backend/          # API, AI layer, domains, DB
  src/
    ai/           # AI providers (OpenAI adapter; we only ask)
    db/           # PostgreSQL schema + client
    domains/      # blackjack, sports, crops
    api/          # REST routes
frontend/         # Dashboard (place bets, view results)
```

## API (examples)

- `GET /health` — health check
- `GET /api/blackjack/models` — list AI models
- `POST /api/blackjack/play` — body: `{ "modelId": "openai-gpt-4o-mini", "betCents": 1000 }` → play one hand, returns outcome and balance

## Env vars

See `.env.example`. Important:

- `DATABASE_URL` — leave empty or set to `sqlite` for SQLite (no install). Set to a Postgres URL to use PostgreSQL.
- `OPENAI_API_KEY` — for OpenAI-backed blackjack AI
- `BLACKJACK_DAILY_CENTS` / `SPORTS_DAILY_CENTS` / `CROP_BANKROLL_CENTS` — 10_000_000 = $100,000

## Next steps (after MVP)

- Hedera smart contracts for settlement and performance state
- Sports and Crops modules + dashboard pages
- User auth and “my bets”
- Crop reference data (USDA/futures) for contract resolution
