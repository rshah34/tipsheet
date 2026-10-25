"""Game-winner model: the home team's chance to win, from each team's point margin
this season, home court, and the scoring each side is missing tonight.

Blind to the betting line. Settings fit on earlier seasons and checked on 2025-26, a
season they never saw (`tipsheet backtest`): Brier 0.1976 there. The missing-players
term is worth 0.006 of that; Claude reading the same form, injuries and news on the
same games scored 0.2432, which is why this replaced it.

The margin itself is calibrated too, which is what a spread would be priced on:
results scatter around the expected margin with an SD of 14.1-14.2 points in each of
2023-24 through 2025-26, close to a bell curve (blowouts a little more common).
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import NormalDist

from tipsheet.features.props import ROTATION_MIN, PropsData, TeamForm

GAME_MODEL = "margin-v1"     # model_version on its predictions and bets
MARGIN_SD = 14.0             # points: how widely results spread around the expected margin
# Home court in today's game: 2.5 overrated the home side by ~0.8 points a game in every
# season. Fit on 2023-24 + 2024-25; on 2025-26 the home bias fell from -1.04 to -0.29.
HOME_COURT = 1.75
MISSING_PTS_WEIGHT = 0.12    # margin points lost per point a game of scoring that sits out
# Before this many games a team's margin is mostly noise, and the market knows far
# more about it than this model does: no prediction, so no bet.
MIN_GAMES = 10
_RECENT = timedelta(days=21)  # out longer than this, and the team's results already show it


def regulars_missing(
    data: PropsData, team_id: int, game_date: date, absent: set[int] | list[int],
) -> list[tuple[int, float]]:
    """The absent players who have been part of the team lately — 12+ minutes a game
    in a game for it within three weeks — with their scoring over the last 10 games,
    most first."""
    out = []
    for pid in absent:
        log = data.log_before(pid, game_date)
        if not log or log[-1].team_id != team_id or log[-1].game_date < game_date - _RECENT:
            continue
        last = log[-10:]
        if sum(g.minutes for g in last) / len(last) < ROTATION_MIN:
            continue
        out.append((pid, sum(g.pts for g in last) / len(last)))
    return sorted(out, key=lambda m: m[1], reverse=True)


def expected_margin(form: dict[int, TeamForm], home_id: int, away_id: int) -> float:
    """The home team's margin this season minus the visitor's, plus home court."""
    home, away = form.get(home_id), form.get(away_id)
    return (home.margin if home else 0.0) - (away.margin if away else 0.0) + HOME_COURT


def win_probability(
    margin: float, home_missing_pts: float, away_missing_pts: float,
) -> tuple[float, float]:
    """(P(home wins), expected home margin) once tonight's absences are counted."""
    adjusted = margin - MISSING_PTS_WEIGHT * (home_missing_pts - away_missing_pts)
    return NormalDist().cdf(adjusted / MARGIN_SD), adjusted
