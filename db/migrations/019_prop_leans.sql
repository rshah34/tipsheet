-- Leans: the model's biggest disagreements with the line on days it has no bets.
-- Recorded and settled like bets, with no stake, and kept out of the betting record.
ALTER TABLE prop_bets ADD COLUMN IF NOT EXISTS lean BOOLEAN NOT NULL DEFAULT FALSE;
