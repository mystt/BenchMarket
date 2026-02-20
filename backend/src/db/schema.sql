-- AI Benchmark Market — PostgreSQL schema
-- Run via: psql $DATABASE_URL -f backend/src/db/schema.sql (or use migrate.ts)

-- AI models we can run (one row per provider/model)
CREATE TABLE IF NOT EXISTS ai_models (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily bankroll state per model per domain (blackjack, sports)
CREATE TABLE IF NOT EXISTS daily_bankrolls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    TEXT NOT NULL REFERENCES ai_models(id),
  domain      TEXT NOT NULL CHECK (domain IN ('blackjack', 'sports')),
  date        DATE NOT NULL,
  balance_cents BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_id, domain, date)
);

-- Crop bankroll (rolling, no daily reset)
CREATE TABLE IF NOT EXISTS crop_bankrolls (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     TEXT NOT NULL REFERENCES ai_models(id),
  balance_cents BIGINT NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_id)
);

-- Blackjack: each hand played
CREATE TABLE IF NOT EXISTS blackjack_hands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      TEXT NOT NULL REFERENCES ai_models(id),
  date          DATE NOT NULL,
  bet_cents     BIGINT NOT NULL,
  player_cards  JSONB NOT NULL,
  dealer_upcard TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('hit', 'stand', 'double', 'split')),
  reasoning     TEXT,
  outcome       TEXT CHECK (outcome IN ('win', 'loss', 'push')),
  pnl_cents     BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blackjack_hands_model_date ON blackjack_hands(model_id, date);

-- Sports: each bet placed (one per match per model per day)
CREATE TABLE IF NOT EXISTS sports_bets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    TEXT NOT NULL REFERENCES ai_models(id),
  date        DATE NOT NULL,
  match_id    TEXT NOT NULL,
  match_label TEXT,
  bet_cents   BIGINT NOT NULL,
  prediction  TEXT NOT NULL,
  reasoning   TEXT,
  outcome     TEXT CHECK (outcome IN ('win', 'loss', 'push', 'pending')),
  pnl_cents   BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sports_bets_model_date ON sports_bets(model_id, date);

-- Crop prediction contracts (the “markets”)
CREATE TABLE IF NOT EXISTS crop_contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question    TEXT NOT NULL,
  region      TEXT,
  crop        TEXT,
  threshold   TEXT NOT NULL,
  resolution  TEXT CHECK (resolution IN ('above', 'below', 'pending')),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Crop bets (AI positions on contracts)
CREATE TABLE IF NOT EXISTS crop_bets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    TEXT NOT NULL REFERENCES ai_models(id),
  contract_id UUID NOT NULL REFERENCES crop_contracts(id),
  bet_cents   BIGINT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('above', 'below')),
  reasoning   TEXT,
  outcome     TEXT CHECK (outcome IN ('win', 'loss', 'pending')),
  pnl_cents   BIGINT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crop_bets_model ON crop_bets(model_id);

-- Market layer: participant bets on AI performance (for dashboard)
CREATE TABLE IF NOT EXISTS performance_bets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain       TEXT NOT NULL CHECK (domain IN ('blackjack', 'sports', 'crops')),
  model_id     TEXT NOT NULL REFERENCES ai_models(id),
  period       TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('outperform', 'underperform')),
  amount_cents BIGINT NOT NULL,
  outcome      TEXT CHECK (outcome IN ('win', 'loss', 'pending')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
