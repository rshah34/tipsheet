-- Game bets on the spread as well as the moneyline: which market, and the line taken
-- (from the side bet, e.g. +6.5). Still one bet per game.
ALTER TABLE bets ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'h2h';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS line NUMERIC;
