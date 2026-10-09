// Small pieces shared by the display and the phone.
import { useEffect, useState } from "react";
import type { GameResults, PhaseTiming } from "@quiz/shared";
import { api } from "./api.ts";
import { useT } from "./strings.ts";
import { useCountdown } from "./useRoom.ts";

/**
 * Answer timer (playtest 1): only while answering, fills left → right as time passes and turns
 * urgent for the last 5 seconds. No bars in other phases, so nothing "runs back and forth".
 */
export function AnswerTimer({ timing, timingAt }: { timing: PhaseTiming | null | undefined; timingAt: number }) {
  const remaining = useCountdown(timing, timingAt);
  if (!timing || remaining === null) return null;
  const elapsed = timing.durationMs ? 1 - remaining / timing.durationMs : 1;
  const urgent = remaining < 5000;
  return (
    <div className={`answer-timer ${urgent ? "urgent" : ""}`} role="timer" aria-label={`${Math.ceil(remaining / 1000)} s`}>
      <div className="track">
        <div className="fill" style={{ width: `${Math.max(0, Math.min(1, elapsed)) * 100}%` }} />
      </div>
      <span className="seconds">{Math.ceil(remaining / 1000)}</span>
    </div>
  );
}

/** On the reveal: "Next question in 4 · 13 to go" — progress and a heads-up before the next one. */
export function NextUp({ timing, timingAt, number, total }: { timing: PhaseTiming | null | undefined; timingAt: number; number: number; total: number }) {
  const t = useT();
  const remaining = useCountdown(timing, timingAt);
  if (!timing || remaining === null) return null;
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  // Same "N of 20" as the question header; "17 to go" read as a random number (PT2, DS-064).
  return <p className={`next-up ${seconds <= 3 ? "soon" : ""}`}>{number < total ? t.nextIn(seconds, number + 1, total) : t.resultsIn(seconds)}</p>;
}

/** Stats of the evening as one list, most important first: the toughest question on top (PT2, DS-073). */
export function StatCards({ results }: { results: GameResults }) {
  const t = useT();
  const s = results.stats;
  const cards = [
    s.hardest && { title: t.statHardest, body: s.hardest.text, note: `${t.correctAnswer}: ${s.hardest.correctText}` },
    s.onlyOneKnew && { title: t.statOnlyOne, body: s.onlyOneKnew.text, note: `${t.correctAnswer}: ${s.onlyOneKnew.correctText}` },
    s.mostDivided && { title: t.statDivided, body: s.mostDivided.text, note: `${t.correctAnswer}: ${s.mostDivided.correctText}` },
    s.everyoneKnew && { title: t.statEveryone, body: s.everyoneKnew.text, note: s.everyoneKnew.correctText },
    // Which question, too (PT2, DS-074): "you answered in one second, but on what?"
    s.fastestCorrect && {
      title: t.statFastest,
      body: `${s.fastestCorrect.nickname} · ${t.seconds(s.fastestCorrect.responseMs)}`,
      note: s.fastestCorrect.question.text,
    },
  ].filter((c): c is { title: string; body: string; note: string } => Boolean(c));
  if (cards.length === 0) return null;
  return (
    <div className="stat-cards">
      {cards.slice(0, 5).map((c) => (
        <div className="stat-card" key={c.title}>
          <p className="stat-title">{c.title}</p>
          <p className="stat-body">{c.body}</p>
          <p className="muted small">{c.note}</p>
        </div>
      ))}
    </div>
  );
}

let betaCache: Promise<boolean> | null = null;

/** "Beta" badge while this deployment plays unreviewed questions (EPIC 38, L-10). Silent on errors. */
export function BetaBadge({ group = false }: { group?: boolean }) {
  const t = useT();
  const [beta, setBeta] = useState(false);
  useEffect(() => {
    betaCache ??= api.meta().then((m) => m.beta).catch(() => false);
    betaCache.then(setBeta);
  }, []);
  if (!beta) return null;
  return (
    <p className={`beta-badge ${group ? "group" : ""}`}>
      <span>{t.beta}</span> <em>{group ? t.betaHintGroup : t.betaHint}</em>
    </p>
  );
}

/** Place by points: equal scores share a place (1, 1, 3), so a tie never reads as a loss. */
export function placeOf(leaderboard: GameResults["leaderboard"], index: number): number {
  const score = leaderboard[index]?.score ?? 0;
  return 1 + leaderboard.filter((l) => l.score > score).length;
}

