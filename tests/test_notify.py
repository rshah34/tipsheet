"""Notification delivery + digest formatting. DB/network-free."""

import httpx

from tipsheet import digest, notify
from tipsheet.config import settings


def test_message_is_written_to_disk_even_with_no_topic(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ntfy_topic", "")
    assert notify.send("hello", log_dir=tmp_path) == "off"
    assert next(tmp_path.glob("digest-*.txt")).read_text() == "hello\n"


def _capture(monkeypatch):
    calls = []

    def post(url, **kw):
        calls.append((url, kw))
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(settings, "ntfy_topic", "tipsheet-test-topic")
    monkeypatch.setattr(httpx, "post", post)
    return calls


def test_first_line_is_the_title_and_a_pick_day_is_loud(tmp_path, monkeypatch):
    calls = _capture(monkeypatch)
    assert notify.send("NBA best bets, Thu Oct 29\nOVER 38.5 PRA", log_dir=tmp_path) == "ok"
    url, kw = calls[0]
    assert url == "https://ntfy.sh/tipsheet-test-topic"
    assert kw["headers"]["Title"] == "NBA best bets, Thu Oct 29"
    assert kw["content"] == "OVER 38.5 PRA".encode() and kw["headers"]["Priority"] == "4"


def test_a_no_bets_day_goes_out_quietly(tmp_path, monkeypatch):
    calls = _capture(monkeypatch)
    notify.send(f"NBA best bets, Sun Oct 25\n{digest.NO_BETS}", log_dir=tmp_path, quiet=True)
    assert calls[0][1]["headers"]["Priority"] == "2"


def test_a_failed_send_is_reported_not_raised(tmp_path, monkeypatch):
    def boom(url, **kw):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(settings, "ntfy_topic", "tipsheet-test-topic")
    monkeypatch.setattr(httpx, "post", boom)
    assert notify.send("hi", log_dir=tmp_path) == "ConnectError: offline"


def test_american_odds_formatting():
    assert digest._american(1.909) == "-110"
    assert digest._american(2.2) == "+120"
    assert digest._american(2.0) == "+100"


def test_stake_shows_dollars_only_when_a_bankroll_is_set(monkeypatch):
    monkeypatch.setattr(settings, "bankroll", 0.0)
    assert digest._stake(0.015) == "1.5u"
    monkeypatch.setattr(settings, "bankroll", 2000.0)
    assert digest._stake(0.015) == "1.5u ($30)"
