-- The Claude game predictor's written reasoning. The statistical model that replaced it
-- (October 2026) keeps its factors in context_used.key_factors instead.
ALTER TABLE predictions DROP COLUMN IF EXISTS reasoning;
