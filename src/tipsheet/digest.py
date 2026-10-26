"""Build the text messages: today's best bets, a late update when the injury
report undercuts one, and last night's results."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from tipsheet.agents import props_agent
from tipsheet.config import settings
from tipsheet.db.models import Bet, Game, Team
from tipsheet.features.props import GUIDE_STATS, MARKET_LABELS

_BOOKS = {"draftkings": "DK", "fanduel": "FD", "betmgm": "MGM", "williamhill_us": "Caesars",
          "espnbet": "ESPN", "betrivers": "Rivers", "fanatics": "Fanatics", "bovada": "Bovada",
          "betonlineag": "BetOnline", "hardrockbet": "HardRock", "kalshi": "Kalshi"}


def _american(decimal_odds: float) -> str:
    if decimal_odds >= 2:
        return f"+{round((decimal_odds - 1) * 100)}"
    return f"-{round(100 / (decimal_odds - 1))}"


def _stake(fraction: float) -> str:
    """Stake as units (1u = 1% of bankroll), plus dollars when a bankroll is set."""
    units = f"{fraction * 100:.1f}u"
    return f"{units} (${fraction * settings.bankroll:,.0f})" if settings.bankroll > 0 else units


def _playable(odds, line=None, bet_line=None) -> str | None:
    """How far the price (and a prop's line) can move before the bet is a pass."""
    if odds is None:
        return None
    text = f"   Playable to {_american(float(odds))}"
    if line is not None and float(line) != float(bet_line):
        text += f", or to a line of {float(line):g} at the price above"
    return text


def _local_time(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone().strftime("%-I:%M%p").lower()


def _teams(session: Session) -> dict[int, str]:
    return {t.team_id: t.abbreviation for t in session.execute(select(Team)).scalars()}


def pick_label(candidate: dict) -> str:
    """One-line description of a pick, for run logs."""
    d = candidate["decision"]
    if candidate["kind"] == "game":
        return f"game {candidate['game_id']} {d.side} ML"
    return (f"{candidate['player_name']} {d.side} {d.line:g} "
            f"{MARKET_LABELS.get(candidate['market'], candidate['market'])}")


NO_BETS = "No bets today: nothing cleared the edge threshold."


def best_bets(session: Session, game_date: date) -> str:
    """The pre-game text: the day's picks — game winners and props together — with
    the biggest edge first."""
    teams = _teams(session)
    props = props_agent.todays_bets(session, game_date)
    game_bets = session.execute(
        select(Bet, Game).join(Game, Bet.game_id == Game.game_id)
        .where(Game.game_date == game_date)
    ).all()
    tips = dict(session.execute(
        select(Game.game_id, Game.tipoff_at).where(Game.game_date == game_date)
    ).all())

    lines = [f"NBA best bets, {game_date:%a %b %-d}"]
    if not props and not game_bets:
        lines.append(NO_BETS)
        return "\n".join(lines)

    def detail(bet, why: str | None, playable: str | None) -> list[str]:
        when = _local_time(tips.get(bet.game_id))
        numbers = (f"   model {float(bet.model_prob):.0%}, mkt {float(bet.market_prob):.0%}, "
                   f"edge {float(bet.edge):+.1%} | {_stake(float(bet.stake_fraction))}"
                   + (f" | tip {when}" if when else ""))
        return [*([f"   Why: {why}"] if why else []), *([playable] if playable else []), numbers]

    def book(key: str | None) -> str:
        return _BOOKS.get(key, key or "")

    entries: list[tuple[float, list[str]]] = []
    for b in props:
        block = [
            f"{b.player_name} ({teams.get(b.team_id, '?')}) {b.side.upper()} {float(b.line):g} "
            f"{MARKET_LABELS.get(b.market, b.market)} {_american(float(b.decimal_odds))} "
            f"{book(b.sportsbook)}",
            *detail(b, b.notes, _playable(b.playable_odds, b.playable_line, b.line)),
        ]
        if b.stat_guide:
            def bound(v) -> str:
                return f"{v:g}" if v is not None else "–"

            block.append("   single stats (over if the line is at or below / under if at or above):")
            # In a fixed order: a JSON column doesn't keep the order it was written in.
            block.append("   " + " · ".join(
                f"{stat.upper()} {bound(b.stat_guide[stat]['over_at'])} / "
                f"{bound(b.stat_guide[stat]['under_at'])}"
                for stat, _market in GUIDE_STATS if stat in b.stat_guide))
        entries.append((float(b.edge), block))
    for bet, game in game_bets:
        side, other = ((game.home_team_id, game.away_team_id) if bet.side == "home"
                       else (game.away_team_id, game.home_team_id))
        where = "vs" if bet.side == "home" else "at"
        entries.append((float(bet.edge), [
            f"{teams.get(side, '?')} to win {where} {teams.get(other, '?')} "
            f"{_american(float(bet.decimal_odds))} {book(bet.sportsbook)}".rstrip(),
            *detail(bet, bet.reason, _playable(bet.playable_odds)),
        ]))

    entries.sort(key=lambda e: e[0], reverse=True)
    for i, (_edge, block) in enumerate(entries, 1):
        lines.append("")
        lines.append(f"{i}. {block[0]}")
        lines.extend(block[1:])

    total = sum(float(b.stake_fraction) for b in props) + sum(
        float(b.stake_fraction) for b, _ in game_bets)
    lines.append(f"\nTotal at risk: {_stake(total)}. Paper trading: verify the price before betting.")
    return "\n".join(lines)


def pick_update(game_date: date, updates: list[str]) -> str:
    """The late text: picks the newest injury report has undercut (`picks.recheck`)."""
    return "\n".join([f"NBA pick update, {game_date:%a %b %-d}", *updates])
