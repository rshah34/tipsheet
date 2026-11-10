"use client";

import Link from "next/link";
import { CalibrationChart } from "@/components/CalibrationChart";
import { ResultBadge } from "@/components/PickList";
import { SortableTable, type Column } from "@/components/SortableTable";
import { Card, Empty, PageState, SectionTitle, Tile } from "@/components/ui";
import { useApi } from "@/lib/api";
import { american, num, pct, shortDate, signed } from "@/lib/format";
import type { BacktestReport, Pick, PicksPayload } from "@/lib/types";

const columns: Column<Pick>[] = [
  { key: "date", header: "Date", sort: (p) => p.date, render: (p) => shortDate(p.date) },
  {
    key: "label",
    header: "Pick",
    sort: (p) => p.label,
    render: (p) => (
      <>
        {p.player_id ? (
          <Link href={`/players/${p.player_id}`} className="font-medium text-primary hover:underline">
            {p.label}
          </Link>
        ) : (
          <span className="font-medium text-primary">{p.label}</span>
        )}
        {p.lean && (
          <span title="Not a bet: the model's disagreement with the line, graded but not staked" className="ml-2 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium text-secondary">
            lean
          </span>
        )}
      </>
    ),
  },
  { key: "matchup", header: "Game", render: (p) => <Link href={`/games/${p.game_id}`} className="hover:underline">{p.matchup}</Link> },
  { key: "odds", header: "Price", align: "right", sort: (p) => p.odds, render: (p) => american(p.odds) },
  { key: "edge", header: "Edge", align: "right", sort: (p) => p.edge, render: (p) => (p.edge == null ? "—" : signed(p.edge * 100)) },
  { key: "stake", header: "Stake", align: "right", sort: (p) => p.stake, render: (p) => (p.lean ? "—" : p.stake == null ? "—" : `${(p.stake * 100).toFixed(1)}u`) },
  { key: "result", header: "Result", sort: (p) => p.result ?? "", render: (p) => <ResultBadge result={p.result} /> },
  { key: "actual", header: "Actual", align: "right", sort: (p) => p.actual, render: (p) => (p.actual == null ? "" : num(p.actual, 0)) },
  { key: "pnl", header: "Units", align: "right", sort: (p) => p.pnl, render: (p) => (p.pnl == null || p.lean ? "" : signed(p.pnl * 100, 2)) },
  { key: "clv", header: "CLV", align: "right", title: "Closing-line value, in probability points", sort: (p) => p.clv, render: (p) => (p.clv == null ? "" : signed(p.clv * 100)) },
];

/** How the game model in use has done on the games it has predicted live. */
function GameModelAccuracy() {
  const { data: report } = useApi<BacktestReport>("/game-model");
  if (!report) return null;

  return (
    <section className="mt-10">
      <SectionTitle hint="The live game-winner model, graded on the games it predicted before tip.">
        Game model accuracy
      </SectionTitle>
      {report.n === 0 ? (
        <Card className="border-dashed px-4 py-3 text-sm text-secondary">
          Nothing graded yet. The first regular-season games are scored the day after they are played.
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Games scored" value={report.n} />
            <Tile label="Winner accuracy" value={pct(report.winner_accuracy, 1)} hint="picked the eventual winner" />
            <Tile label="Brier score" value={num(report.mean_brier, 3)} hint="lower is better; 0.25 is a coin flip" />
            <Tile label="Log-loss" value={num(report.mean_log_loss, 3)} hint="lower is better" />
          </div>
          <Card className="p-5">
            <h3 className="text-sm font-medium text-primary">Calibration</h3>
            <p className="mb-4 mt-0.5 text-xs text-secondary">
              When the model says 70%, does the home team win about 70% of the time?
            </p>
            <CalibrationChart bins={report.calibration} />
          </Card>
        </>
      )}
    </section>
  );
}

export default function PicksPage() {
  const { data, error, loading } = useApi<PicksPayload>("/picks");
  if (!data) return <PageState loading={loading} error={error} />;
  const { props, games, picks } = data;
  const settled = props.n_bets + games.n_bets;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-primary">Picks</h1>
      <p className="mt-1 max-w-2xl text-sm text-secondary">
        Every paper bet and how it finished. Closing-line value says more than win-loss over a short run.
      </p>

      {picks.length === 0 ? (
        <div className="mt-6">
          <Empty title="No picks recorded yet">
            The first picks are made on opening night. Each player&apos;s first five games with his team are priced but
            not bet, so prop picks start a little later.
          </Empty>
        </div>
      ) : (
        <>
          <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Prop picks" value={`${props.wins}-${props.losses}${props.pushes ? `-${props.pushes}` : ""}`} hint={`${signed(props.units)} units · ROI ${pct(props.roi, 1)}`} />
            <Tile
              label="Prop closing-line value"
              value={props.avg_clv == null ? "—" : `${signed(props.avg_clv * 100)} pts`}
              hint={props.clv_positive_rate == null ? "no closing prices yet" : `beat the close ${pct(props.clv_positive_rate)} of the time`}
            />
            <Tile
              label="Prop leans"
              value={props.leans.n ? `${props.leans.wins}-${props.leans.losses}${props.leans.pushes ? `-${props.leans.pushes}` : ""}` : "—"}
              hint={props.leans.n ? `${signed(props.leans.units)} units at 1 each · not bets` : "not bets; graded after each game"}
            />
            <Tile label="Game picks" value={games.n_bets} hint={games.n_bets ? `won ${pct(games.win_rate)} · ROI ${pct(games.roi, 1)}` : "none settled"} />
            <Tile
              label="Single-stat guidance"
              value={props.guide ? pct(props.guide.hits / props.guide.calls) : "—"}
              hint={props.guide ? `${props.guide.hits} of ${props.guide.calls} calls; the bar is ${pct(props.guide.target)}` : "graded after each game"}
            />
          </div>
          {props.markets.length > 0 && (
            <div className="tnum mb-6 space-y-1 text-sm text-secondary">
              <p>Every prop line priced, bet or not. Brier score, lower is better; bets lean on the model only as far as it beats the market.</p>
              {props.markets.map((m) => (
                <p key={m.market}>
                  <span className="font-medium text-primary">{m.label}</span> · {m.n} lines · model{" "}
                  <span className="font-medium text-primary">{num(m.brier_model, 4)}</span>, market{" "}
                  <span className="font-medium text-primary">{num(m.brier_market, 4)}</span> · trust{" "}
                  <span className="font-medium text-primary">{pct(m.trust.model_weight)}</span>
                  {m.trust.learned ? "" : m.trust.borrowed ? " (borrowed until 300 lines)" : " (starting share)"}
                </p>
              ))}
            </div>
          )}
          <SectionTitle>History{settled ? "" : " (none settled yet)"}</SectionTitle>
          <Card className="p-2">
            <SortableTable rows={picks} columns={columns} rowKey={(p) => `${p.game_id}-${p.label}`} initialSort={{ key: "date", dir: "desc" }} pageSize={25} />
          </Card>
        </>
      )}

      <GameModelAccuracy />
    </div>
  );
}
