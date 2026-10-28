"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { GameCard } from "@/lib/types";
import { PickCards } from "@/components/PickList";
import { InjuryList, ReportList } from "@/components/Reports";
import { SortableTable, type Column } from "@/components/SortableTable";
import { Card, doubtLabel, NoGamesYet, PageState, SectionTitle, Segmented, StatusBadge, TeamLink, TeamMark } from "@/components/ui";
import { useApi } from "@/lib/api";
import { clock, fairOdds, longDate, madeOf, num, pct, seriesLine, SHOT_TYPES, shotPct, STAT_LABELS } from "@/lib/format";
import { coverChance, modelLine } from "@/lib/spread";
import { pra } from "@/lib/markets";
import type { GameDetail, GamePlayer, GameSide, StatLine } from "@/lib/types";

type View = "actual" | "avg" | "proj";
type Col = "min" | "pts" | "reb" | "ast" | "fg3m" | "stl" | "blk" | "tov" | "pra";
// A played game reads like a box score (shots go after points, as makes-attempts); a
// projection adds the combined line the picks are made in.
const BOX_LEAD: Col[] = ["min", "pts"];
const BOX_REST: Col[] = ["reb", "ast", "stl", "blk", "tov"];
const PROJ_COLS: Col[] = ["min", "pts", "reb", "ast", "fg3m", "pra"];
const value = (line: StatLine | null, key: Col) => (line == null ? null : key === "pra" ? pra(line) : line[key]);

const MAX_SPREAD = 30;

/** A typed spread as a number, to the nearest half point, kept within ±30; null if
 * it means nothing. "+3", "3", "-3.5" and "−3.5" all work. */
function parseSpread(text: string): number | null {
  const v = Number(text.replace("−", "-").replace(/[^\d.+-]/g, ""));
  if (!text.trim() || Number.isNaN(v)) return null;
  return Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, Math.round(v * 2) / 2));
}

const showSpread = (s: number) => (s > 0 ? `+${s}` : s < 0 ? `−${-s}` : "PK");

/** Any spread on either side, priced by the model: its chance to cover (and to push,
 * on a whole number) and the fair odds. The sportsbooks' spreads aren't fetched. */
function SpreadChecker({ game }: { game: GameCard }) {
  const fav: "home" | "away" = (game.model_margin ?? 0) >= 0 ? "home" : "away";
  const [side, setSide] = useState<"home" | "away">(fav);
  const start = -Math.round(Math.abs(game.model_margin ?? 0) * 2) / 2 || -0.5;
  const [spread, setSpread] = useState(side === fav ? start : -start);
  const [draft, setDraft] = useState(showSpread(spread));
  const set = (v: number) => {
    const clipped = Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, v));
    setSpread(clipped);
    setDraft(showSpread(clipped));
  };
  const { cover, push } = coverChance(game, side, spread);
  const lose = 1 - cover - push;
  const team = game[side];
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted">Spread checker</div>
        <Segmented
          label="Team"
          value={side}
          onChange={(v) => {
            if (v === side) return;
            setSide(v);
            set(-spread);   // the same line, from the other side
          }}
          options={[
            { value: "away", label: game.away.abbr },
            { value: "home", label: game.home.abbr },
          ]}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-primary">{team.abbr}</span>
        <button type="button" aria-label="Lower" onClick={() => set(spread - 0.5)}
          className="h-7 w-7 rounded-md border border-[var(--border)] text-secondary hover:text-primary">−</button>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Spread"
          maxLength={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => set(parseSpread(draft) ?? spread)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onFocus={(e) => e.currentTarget.select()}
          className="tnum w-20 rounded-md border border-[var(--border)] bg-surface px-2 py-1 text-center text-sm font-semibold text-primary"
        />
        <button type="button" aria-label="Raise" onClick={() => set(spread + 0.5)}
          className="h-7 w-7 rounded-md border border-[var(--border)] text-secondary hover:text-primary">+</button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Covers</dt>
          <dd className="tnum text-lg font-semibold text-primary">{pct(cover)}</dd>
          <dd className="tnum text-xs text-muted">fair {fairOdds(cover / (1 - push))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Doesn&apos;t</dt>
          <dd className="tnum text-lg font-semibold text-primary">{pct(lose)}</dd>
          <dd className="tnum text-xs text-muted">fair {fairOdds(lose / (1 - push))}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Push</dt>
          <dd className="tnum text-lg font-semibold text-primary">{push > 0 ? pct(push) : "—"}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        {`From the model alone: ${modelLine(game)}, results spread ±${num(game.margin_sd, 0)} points around it. `}
        Sportsbook spreads aren&apos;t fetched.
      </p>
    </Card>
  );
}

/** What is moving a team's projections, each note with the players it applies to. */
function Adjustments({ players }: { players: GamePlayer[] }) {
  const byNote = new Map<string, string[]>();
  for (const p of players) for (const n of p.notes) byNote.set(n, [...(byNote.get(n) ?? []), p.name]);
  if (byNote.size === 0) return null;
  return (
    <div className="mt-4 border-t border-[var(--border)] pt-3">
      <div className="mb-2 text-xs font-medium text-muted">Adjustments to these projections</div>
      <ul className="space-y-1.5 text-xs text-secondary">
        {[...byNote].slice(0, 6).map(([note, names]) => (
          <li key={note} className="flex gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>
              <span className="font-medium text-primary">
                {names.length > 3 ? `${names.length} players` : names.join(", ")}
              </span>
              {": "}
              {note.replace(/^news: /, "")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One team's table: what each player did, or what the model projects for him. */
function BoxScore({ side, view }: { side: GameSide; view: View }) {
  const line = (r: GamePlayer) => (view === "actual" ? r.actual : view === "avg" ? r.avg : r.proj);
  // Season averages list everyone expected to play, games this season or not.
  const players = side.players.filter((r) => view === "avg" || line(r) != null);
  const stat = (key: Col): Column<GamePlayer> => ({
    key,
    header: STAT_LABELS[key],
    align: "right",
    sort: (r) => value(line(r), key),
    render: (r) => num(value(line(r), key), view === "actual" || (view === "proj" && key === "min") ? 0 : 1),
  });
  // Made-attempted, sorted by makes; the percentage shows on hover.
  const shots = (t: (typeof SHOT_TYPES)[number]): Column<GamePlayer> => ({
    key: t.key,
    header: t.label,
    align: "right",
    sort: (r) => r.actual?.[t.made] ?? null,
    render: (r) =>
      r.actual ? (
        <span title={pct(shotPct(r.actual[t.made], r.actual[t.tried]), 1)}>
          {madeOf(r.actual[t.made], r.actual[t.tried])}
        </span>
      ) : null,
  });
  const columns: Column<GamePlayer>[] = [
    {
      key: "name",
      header: "Player",
      sort: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2">
          <Link href={`/players/${r.id}`} className="font-medium text-primary hover:underline">
            {r.name}
          </Link>
          <span title={r.status ?? undefined}>
            <StatusBadge status={r.status ? doubtLabel(r.status) : null} />
          </span>
          {view === "avg" && !r.avg && !r.status && <NoGamesYet last={r.last_season} />}
        </span>
      ),
    },
    ...(view === "actual" ? BOX_LEAD : PROJ_COLS).map(stat),
    ...(view === "actual" ? [...SHOT_TYPES.map(shots), ...BOX_REST.map(stat)] : []),
  ];
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-primary">
          <TeamLink id={side.team.id} abbr={side.team.name} mark={side.team.abbr} />
        </h3>
      </div>
      {players.length > 0 ? (
        <SortableTable
          key={view}
          dense
          rows={players}
          columns={columns}
          rowKey={(r) => r.id}
          initialSort={{ key: "pts", dir: "desc" }}
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted">
          {view === "actual" ? "The box score isn't in yet. It arrives with the next daily run." : "No players to show for this team yet."}
        </p>
      )}
      {view === "proj" && <Adjustments players={players} />}
      {side.injuries.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="mb-2 text-xs font-medium text-muted">Injury report</div>
          <InjuryList injuries={side.injuries} />
        </div>
      )}
      {side.reports.length > 0 && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="text-xs font-medium text-muted">News</div>
          <ReportList reports={side.reports} />
        </div>
      )}
    </Card>
  );
}

export default function GamePage() {
  const { id } = useParams<{ id: string }>();
  const { data: game, error, loading } = useApi<GameDetail>(`/games/${id}`);
  const [chosen, setChosen] = useState<View | null>(null);
  if (!game) return <PageState loading={loading} error={error} />;
  const final = game.status === "final";
  const view: View = chosen ?? (final ? "actual" : "avg");

  return (
    <div>
      <Link href={`/?date=${game.date}`} className="text-xs text-secondary hover:text-primary">
        ← {longDate(game.date)}
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-x-2.5 text-2xl font-semibold tracking-tight text-primary">
            <TeamMark abbr={game.away.abbr} className="h-3.5 w-3.5" />
            {game.away.name} <span className="font-normal text-muted">at</span>
            <TeamMark abbr={game.home.abbr} className="h-3.5 w-3.5" />
            {game.home.name}
          </h1>
          <p className="mt-1 text-sm text-secondary">
            {final ? `Final: ${game.away.abbr} ${game.away.score}, ${game.home.abbr} ${game.home.score}` : `Tip ${clock(game.tipoff_at) || "time not set"}`}
            {game.preseason ? " · Preseason" : ""}
            {game.series ? ` · ${seriesLine(game.home.abbr, game.away.abbr, game.series)}` : ""}
          </p>
        </div>
        {(game.model_home_prob != null || game.market_home_prob != null) && (
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-xs text-muted">Model: {game.home.abbr} wins</dt>
              <dd className="text-xl font-semibold text-primary">{pct(game.model_home_prob)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Market</dt>
              <dd className="text-xl font-semibold text-primary">{pct(game.market_home_prob)}</dd>
            </div>
            {modelLine(game) && (
              <div title="The model's expected margin, as a spread on its favorite">
                <dt className="text-xs text-muted">Model line</dt>
                <dd className="tnum text-xl font-semibold text-primary">{modelLine(game)}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {game.picks.length > 0 && (
        <section className="mb-8">
          <SectionTitle>Picks in this game</SectionTitle>
          <PickCards picks={game.picks} />
        </section>
      )}

      {(game.key_factors?.length || (game.model_margin != null && !final)) && (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          {game.key_factors && game.key_factors.length > 0 && (
            <Card className="p-4">
              <div className="text-xs font-medium text-muted">Why the model sees it this way</div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-secondary marker:text-accent">
                {game.key_factors.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Card>
          )}
          {game.model_margin != null && !final && <SpreadChecker game={game} />}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
            <span className="h-3.5 w-1 rounded-full bg-accent" aria-hidden />
            {view === "actual" ? "Box score" : view === "avg" ? "Season averages" : "Projected box score"}
          </h2>
          {view !== "actual" && (
            <p className="mt-0.5 pl-3 text-xs text-muted">
              {view === "avg"
                ? `Per game in ${game.season}, for everyone expected to play. PRA is points + rebounds + assists.`
                : "The model's expected line for this game. PRA is points + rebounds + assists."}
            </p>
          )}
        </div>
        <Segmented
          label="Numbers shown"
          value={view}
          onChange={setChosen}
          options={[
            final ? { value: "actual", label: "What happened" } : { value: "avg", label: "Season averages" },
            { value: "proj", label: final ? "What the model projected" : "Model projection" },
          ]}
        />
      </div>
      {/* A full box score is too wide to sit side by side, so the teams stack. */}
      <div className={`grid gap-4 ${view === "actual" ? "" : "lg:grid-cols-2"}`}>
        <BoxScore side={game.away_side} view={view} />
        <BoxScore side={game.home_side} view={view} />
      </div>
    </div>
  );
}
