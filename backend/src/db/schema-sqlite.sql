-- AI Benchmark Market — SQLite schema (no PostgreSQL required)
-- Ids are passed from app (crypto.randomUUID()) for inserts that need them.

CREATE TABLE IF NOT EXISTS ai_models (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  provider   TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_bankrolls (
  id           TEXT PRIMARY KEY,
  model_id     TEXT NOT NULL REFERENCES ai_models(id),
  domain       TEXT NOT NULL CHECK (domain IN ('blackjack', 'sports')),
  date         TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (model_id, domain, date)
);

CREATE TABLE IF NOT EXISTS crop_bankrolls (
  id           TEXT PRIMARY KEY,
  model_id     TEXT NOT NULL REFERENCES ai_models(id),
  balance_cents INTEGER NOT NULL,
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (model_id)
);

CREATE TABLE IF NOT EXISTS blackjack_hands (
  id            TEXT PRIMARY KEY,
  model_id      TEXT NOT NULL REFERENCES ai_models(id),
  date          TEXT NOT NULL,
  bet_cents     INTEGER NOT NULL,
  player_cards  TEXT NOT NULL,
  dealer_upcard TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('hit', 'stand', 'double', 'split')),
  reasoning     TEXT,
  outcome       TEXT CHECK (outcome IN ('win', 'loss', 'push')),
  pnl_cents     INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_blackjack_hands_model_date ON blackjack_hands(model_id, date);

CREATE TABLE IF NOT EXISTS sports_bets (
  id          TEXT PRIMARY KEY,
  model_id    TEXT NOT NULL REFERENCES ai_models(id),
  date        TEXT NOT NULL,
  match_id    TEXT NOT NULL,
  match_label TEXT,
  bet_cents   INTEGER NOT NULL,
  prediction  TEXT NOT NULL,
  reasoning   TEXT,
  outcome     TEXT CHECK (outcome IN ('win', 'loss', 'push', 'pending')),
  pnl_cents   INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sports_bets_model_date ON sports_bets(model_id, date);

CREATE TABLE IF NOT EXISTS crop_contracts (
  id          TEXT PRIMARY KEY,
  question    TEXT NOT NULL,
  region      TEXT,
  crop        TEXT,
  threshold   TEXT NOT NULL,
  resolution  TEXT CHECK (resolution IN ('above', 'below', 'pending')),
  resolved_at TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crop_bets (
  id          TEXT PRIMARY KEY,
  model_id    TEXT NOT NULL REFERENCES ai_models(id),
  contract_id TEXT NOT NULL REFERENCES crop_contracts(id),
  bet_cents   INTEGER NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('above', 'below')),
  reasoning   TEXT,
  outcome     TEXT CHECK (outcome IN ('win', 'loss', 'pending')),
  pnl_cents   INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_crop_bets_model ON crop_bets(model_id);

CREATE TABLE IF NOT EXISTS performance_bets (
  id           TEXT PRIMARY KEY,
  domain       TEXT NOT NULL CHECK (domain IN ('blackjack', 'sports', 'crops')),
  model_id     TEXT NOT NULL REFERENCES ai_models(id),
  period       TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('outperform', 'underperform')),
  amount_cents INTEGER NOT NULL,
  outcome      TEXT CHECK (outcome IN ('win', 'loss', 'pending')),
  created_at   TEXT DEFAULT (datetime('now'))
);
