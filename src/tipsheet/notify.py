"""Send the day's message as a push notification through ntfy (ntfy.sh): a free,
open-source service with phone apps. The pipeline posts to a topic; the ntfy app,
subscribed to that topic, shows it as its own notification. The topic name is the
only key, so it is long and random and lives in .env.

"No bets today" goes out quietly (in the notification list, no sound) so a day
with a pick is the one that buzzes; silence still means the run didn't happen.

A failed send never fails the pipeline: the message is always written to
`logs/<kind>-<date>.txt` first.
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import httpx

from tipsheet.config import settings

log = logging.getLogger("tipsheet.notify")

_QUIET, _LOUD = "2", "4"     # ntfy priorities: low (silent), high (sound + banner)


def send(text: str, log_dir: str | Path = "logs", kind: str = "digest", quiet: bool = False) -> str:
    """Write the message to disk, then push it. The first line is the title. Returns
    "ok", "off" (no topic configured), or the error; it never raises on delivery."""
    d = Path(log_dir)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{kind}-{date.today():%Y-%m-%d}.txt").write_text(text + "\n")

    if not settings.ntfy_topic:
        return "off"
    title, _, body = text.partition("\n")
    try:
        resp = httpx.post(
            f"{settings.ntfy_server.rstrip('/')}/{settings.ntfy_topic}",
            content=(body or title).encode(),
            # Headers must be ASCII-safe; the title is short and plain.
            headers={"Title": title.encode("ascii", "replace").decode(),
                     "Priority": _QUIET if quiet else _LOUD, "Tags": "basketball"},
            timeout=30,
        )
        resp.raise_for_status()
        return "ok"
    except Exception as exc:  # noqa: BLE001 — delivery must never break the run
        result = f"{type(exc).__name__}: {exc}"
    log.warning("notification not sent: %s", result)
    return result
