from types import SimpleNamespace

from tipsheet import digest
from tipsheet.agents.props_agent import lean_record


def _lean(result=None, odds=1.909, **kw):
    return SimpleNamespace(player_name="Jalen Brunson", team_id=1, side="over", line=38.5,
                           market="player_points_rebounds_assists", decimal_odds=odds,
                           sportsbook="draftkings", model_prob=0.62, market_prob=0.48,
                           result=result, **kw)


def test_leans_are_labelled_as_not_bets():
    block = digest._leans([_lean()], {1: "NYK"})
    assert "not bets" in block[1]
    assert block[2] == "- Jalen Brunson (NYK) OVER 38.5 PTS+REB+AST -110 DK: model 62%, mkt 48%"
    assert digest._leans([], {}) == []


def test_lean_record_scores_each_as_one_unit_at_its_price():
    rec = lean_record([_lean("won", odds=2.0), _lean("lost"), _lean("push")])
    assert rec == {"n": 3, "wins": 1, "losses": 1, "pushes": 1, "units": 0.0}
