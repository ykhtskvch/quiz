// Small pieces shared by the display and the phone.
import type { GameResults, PhaseTiming } from "@quiz/shared";
import { t } from "./strings.ts";
import { useCountdown } from "./useRoom.ts";

/** Shrinking bar for the current phase; shows seconds when `showSeconds`. */
export function PhaseBar({ timing, timingAt, showSeconds = false }: { timing: PhaseTiming | null | undefined; timingAt: number; showSeconds?: boolean }) {
  const remaining = useCountdown(timing, timingAt);
  if (!timing || remaining === null) return null;
  const fraction = timing.durationMs ? remaining / timing.durationMs : 0;
  const urgent = remaining < 5000;
  return (
    <div className={`phase-bar ${urgent ? "urgent" : ""}`} role="timer" aria-label={`${Math.ceil(remaining / 1000)} c`}>
      <div className="track">
        <div className="fill" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      </div>
      {showSeconds && <span className="seconds">{Math.ceil(remaining / 1000)}</span>}
    </div>
  );
}

export function StatCards({ results }: { results: GameResults }) {
  const s = results.stats;
  const cards = [
    s.hardest && { title: t.statHardest, body: s.hardest.text, note: `${t.correctAnswer}: ${s.hardest.correctText}` },
    s.onlyOneKnew && { title: t.statOnlyOne, body: s.onlyOneKnew.text, note: `${t.correctAnswer}: ${s.onlyOneKnew.correctText}` },
    s.mostDivided && { title: t.statDivided, body: s.mostDivided.text, note: `${t.correctAnswer}: ${s.mostDivided.correctText}` },
    s.everyoneKnew && { title: t.statEveryone, body: s.everyoneKnew.text, note: s.everyoneKnew.correctText },
    s.fastestCorrect && { title: t.statFastest, body: s.fastestCorrect.nickname, note: t.seconds(s.fastestCorrect.responseMs) },
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
