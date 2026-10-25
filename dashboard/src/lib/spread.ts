/** Spreads from the game model: its expected margin and how widely results spread
 * around it (a bell curve, checked on four seasons). */
import type { GameCard } from "./types";

/** Standard normal CDF (Abramowitz & Stegun 7.1.26; error under 1e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** The model's line as a spread on its favorite ("BOS -3.2"), or "Even". */
export function modelLine(game: GameCard): string | null {
  const m = game.model_margin;
  if (m == null) return null;
  if (Math.abs(m) < 0.25) return "Even";
  return `${m > 0 ? game.home.abbr : game.away.abbr} −${Math.abs(m).toFixed(1)}`;
}

/** Chance that a side covers `spread` (its own spread: -3.5 gives 3.5 points) and,
 * on a whole-number spread other than a pick'em, that it lands exactly on it. Margins
 * are whole points, so each outcome is the bell curve over its half-point either side. */
export function coverChance(game: GameCard, side: "home" | "away", spread: number) {
  const m = (game.model_margin ?? 0) * (side === "home" ? 1 : -1);
  const sd = game.margin_sd;
  const needed = -spread; // the margin he has to beat
  const below = (x: number) => normalCdf((x - m) / sd);
  // A pick'em is the moneyline: games can't end tied, so there is no push.
  if (Number.isInteger(needed) && needed !== 0) {
    const push = below(needed + 0.5) - below(needed - 0.5);
    return { cover: 1 - below(needed + 0.5), push };
  }
  return { cover: 1 - below(needed), push: 0 };
}
