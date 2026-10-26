# Scheduling the daily pipeline

Three commands. Every step inside a run is fault-isolated (a flaky API call is logged and skipped, the run continues), and every run appends a one-line summary to `logs/pipeline-runs.jsonl`.

| Run | Command | What it does |
|-----|---------|--------------|
| morning | `tipsheet morning` | last night's final scores + box scores → **settle** bets and grade projections → rosters + injury report + schedule → fetch the news feeds. Free: no odds credits, no Claude, no text |
| daily | `tipsheet daily` | final scores + box scores + today's rosters → **settle** yesterday's bets (CLV + P&L) → injuries + news → player signals → predict each game → current game + prop odds → **choose the day's 2–3 picks** → **text them** |
| close | `tipsheet daily-close` | re-read the rosters, the injury report and any news since the last run (Claude reads only new articles about teams still to play), and text an update if they undercut a pick; re-capture game lines + the prop markets we hold → these become the **closing prices** |

## Why local (not cloud)

`nba_api` (stats.nba.com) blocks datacenter/cloud IP ranges but works from a normal residential connection, so ingestion must run from your Mac. Local scheduling also means no secrets leave the machine.

## Install (macOS, launchd)

```bash
scripts/schedule.sh install     # renders the plist template with this repo's path and loads it
scripts/schedule.sh status      # confirm it's loaded, and show the last runs
scripts/schedule.sh uninstall   # stop + remove it
```

One launchd job calls `scripts/run_due.sh` every 15 minutes, and the script runs whatever is due. The times are **Pacific, whatever timezone the Mac is set to**: they follow the tip-offs, not the laptop, so travelling changes nothing.

| Job | Time (PT) | Runs | Why then |
|-----|--------------|------|----------|
| morning | 8:00 | `morning` | last night is on the site by breakfast, and the news feeds are read before overnight stories scroll off them |
| daily | 14:30 | `daily` | ~90 min before the first evening tips; **the best-bets text** |
| close | 15:45 and 17:45 | `daily-close` | just before the two waves of tip-offs (4–5 PM and 6–7 PM Pacific) — late news and the closing prices |

**Why these check times.** Placed against this season's schedule, 3:45 and 5:45 give 90% of games a check within 75 minutes of tip, against 58% for 3:30 and 6:30, on the same odds credits. A third check would reach 100% but costs credits the free odds plan doesn't have to spare.

**Why the picks don't depend on the morning run.** Everything they need — last night's results, the injury report, the news, the game predictions — is refreshed again at 2:30, minutes before the prices are taken, so a missed morning run costs nothing but a stale site.

**The picks.** Each day the bot records and texts at most `MAX_DAILY_BETS` bets (default 3), chosen across game winners and player props by edge — the probability it would size on, minus the market's. When both kinds qualify, the best of each is included. They are chosen in the afternoon because props are won on knowing who plays, which firms up through the day (with *stale* availability the projections are worse than with none), and because the price recorded is then the one on offer when the text reaches you.

**Afternoon games are not bet.** A game that tips before the run (weekend and holiday matinees) is skipped: no prediction, no pick. To cover them, run `tipsheet daily` by hand in the morning; the afternoon run then keeps to the same daily cap.

**Why the close is its own run.** CLV — did you get a better number than the close — only exists if the bet and the close are different snapshots. Merge them and CLV is always ~0, which guts the metric the whole system is scored on.

**Timezone:** the script sets `TZ=America/Los_Angeles` for both the schedule and the pipeline, so "today" is the same day whichever coast the Mac is on. To move a time, edit `JOBS` at the top of `scripts/run_due.sh`.

### When the Mac is asleep at run time

A sleeping Mac runs nothing. launchd fires the job once on the next wake, and `scripts/run_due.sh` runs each job whose time has passed since it last ran: morning, then daily, then close (a morning run still owed after 2:30 is skipped, since the daily run does all of it). Each job records when it last finished (`logs/.last-morning`, `logs/.last-daily`, `logs/.last-close`), so none runs twice; one that crashes is tried again 15 minutes later, and with no internet it waits rather than running. It also waits for Wi-Fi, starts Docker if the database isn't up, and holds the Mac awake until the run finishes.

A plugged-in Mac with the lid closed still wakes briefly in the background now and then (Power Nap), and a run that lands in one of those wakes can go through. Don't count on it for a game day: that run takes minutes and sends a text, and a background wake can end first.

What a late run can and can't recover:

- **Results and settlement** — always, just later. The run reaches back to the oldest game still waiting on a result (up to two weeks), so a few days with the laptop shut are caught up on the next run.
- **Bets** — only on games that haven't tipped yet. Wake up after tip and that game is skipped.
- **Closing prices** — only if a `close` run lands between the bet and the tip; otherwise that bet has no CLV.

To have the runs happen on time with nobody at the keyboard, the Mac has to stay awake from mid-afternoon to the last close run: leave it **plugged in with the lid open** and turn on System Settings → Battery → Options → *Prevent automatic sleeping on power adapter when the display is off* (the display still sleeps). A closed lid sleeps the Mac regardless.

If the laptop is usually out of the house or shut in the afternoon, this needs an always-on machine on a home connection instead — any spare Mac running the same setup. A cloud server is not a drop-in: NBA's data endpoints refuse datacenter addresses.

## Getting the notifications

Install the **ntfy** app (iOS or Android, free), subscribe to your topic on the default server (ntfy.sh), set it in `.env`, then run `tipsheet notify-test`:

```bash
NTFY_TOPIC=tipsheet-<long random string>   # the topic is the only key: keep it long and private
BANKROLL=2000                              # optional: shows stakes in dollars too
```

The bot sends one kind of message: the day's best bets. A day with a pick arrives as a normal notification with sound; "No bets today" arrives silently (it still shows in your notifications, so silence means the run didn't happen). A late-news update to a pick also arrives with sound. No account, no cost.

Every digest is also written to `logs/digest-<date>.txt`, so a failed send loses nothing. `tipsheet digest` previews today's text (`--send` delivers it).

## Claude API cost

One thing in the scheduled runs calls Claude — reading the news, at 2:30 and again at the pre-game checks for articles new since — and every call is logged to `logs/api-usage.jsonl` (`tipsheet costs` totals it). Game predictions come from a statistical model and cost nothing. Ask and the research agent run only when you start them. A question costs about a cent (at most $2 a day from the dashboard) and is logged as `ask`; a research run is capped by `--budget` (default $2) and logged as `research`.

| Call | When | Model | Measured cost |
|------|------|-------|---------------|
| News reading | new articles about teams playing today (each article once) | `NEWS_MODEL` (claude-haiku-5-5) | ~$0.02 per 140 articles |

Nothing is paid for twice: each article is read once, and on a day with no games the run only settles results — no model is called and no odds are bought. `claude-opus-5-5` as `NEWS_MODEL` reads the same articles for ~40x the price; on a side-by-side it flagged 17 players out to Haiku's 15, agreeing on 12.

## Odds API budget

Game lines cost one credit per market per snapshot. Props cost **one credit per market per game**, which is what makes them expensive.

**On the free plan (500 credits/month)** — the shipped `.env.example` settings:

| Purchase | Setting | Credits / month (≈7.5 games a night) |
|----------|---------|--------------------------------------|
| Game lines, moneyline only, 3 snapshots a day | `GAME_MARKETS=h2h` | ~90 |
| Props, one market, one snapshot per game | `PROP_MARKETS=player_points_rebounds_assists` | ~225 |
| Closing prices for the prop bets held | automatic | whatever is left, ~100–135 |

One prop market is the most the free plan holds; a second would take ~450 on its own. Points+rebounds+assists is the one to keep: it covers the three main stats for one credit, and it is where the model beat the naive baseline by the most in the season backtest.

The bot paces itself so the month never runs dry: each game is bought once, no game lines are bought on a day with nothing to play, and the closing snapshot — the only optional purchase — runs only while the rest of the month's essentials are still covered. If credits get tight you lose CLV on some prop bets, never the bets themselves. `ODDS_QUOTA_RESERVE` is a last-resort floor that keeps game lines alive.

**On a paid plan**, unset `PROP_MARKETS` and `GAME_MARKETS` to price all 11 prop markets and spreads/totals: about 3,500 credits a month.

## Monitoring

```bash
tail -f logs/daily-$(date +%F).log           # live console output of today's run
tail -5 logs/pipeline-runs.jsonl             # one-line pass/fail summary per run
tipsheet props-record                         # prop paper record: CLV, ROI, model vs. market
tipsheet bets                                 # game-line paper record
```

## Alternative: cron

```cron
*/15 * * * * /ABSOLUTE/PATH/tipsheet/scripts/run_due.sh
```

On macOS, cron needs Full Disk Access granted to `/usr/sbin/cron` in System Settings → Privacy. launchd is the native, recommended path.

## Season-start checklist

1. Docker running (`docker compose up -d`), then `tipsheet morning` to confirm it works from your connection.
2. `tipsheet notify-test` — you should get a notification.
3. `scripts/schedule.sh install`.
4. Props stay unbet for each player's first 5 games with his team (opening-week projections lean on last season's role); every line is still priced and logged. `tipsheet props-record` shows the model vs. the market on those lines from night one.
5. Game bets start once both teams have played 10 games (about three weeks in); before that the model sits out.
6. Judge by CLV, not by a week of P&L.
