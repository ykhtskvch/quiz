// Small pieces shared by the display and the phone.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { GameResults, PhaseTiming, Snapshot } from "@quiz/shared";
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

declare const __LAN_ORIGIN__: string;

/** Where phones should go to join: the LAN address in local dev, the site itself otherwise. */
function joinOrigin() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return local ? __LAN_ORIGIN__ : location.origin;
}

export const joinHost = () => joinOrigin().replace(/^https?:\/\//, "");

/** Join link and its QR, for the TV lobby and, without a TV, for the phones (P-04). */
export function useJoinQr(code: string) {
  const joinUrl = `${joinOrigin()}/j/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    // Level H survives the brand label covering the centre (PT2, DS-049).
    QRCode.toDataURL(joinUrl, { margin: 1, width: 640, errorCorrectionLevel: "H", color: { dark: "#16131f", light: "#ffffff" } }).then(setQr);
  }, [joinUrl]);
  return { joinUrl, qr };
}

export function JoinQr({ qr, joinUrl }: { qr: string | null; joinUrl: string }) {
  const t = useT();
  if (!qr) return null;
  return (
    <div className="qr-wrap">
      <img className="qr" src={qr} alt={joinUrl} />
      <span className="qr-brand" aria-hidden>
        {t.appName}
      </span>
    </div>
  );
}

/**
 * People who came in during a game (P-05): still filling in the setup, or set and waiting for the next
 * question. They join by themselves — showing it is what saves the host from restarting the room.
 */
export function latecomers(s: Snapshot): { settingUp: string[]; waiting: string[] } {
  const live = s.game && s.game.status !== "FINISHED";
  if (!live) return { settingUp: [], waiting: [] };
  const players = s.room.players.filter((p) => p.status !== "DISCONNECTED");
  return {
    settingUp: players.filter((p) => p.status === "ONBOARDING").map((p) => p.nickname),
    waiting: players.filter((p) => p.status === "PENDING").map((p) => p.nickname),
  };
}

export function LatecomersNote({ s, className = "" }: { s: Snapshot; className?: string }) {
  const t = useT();
  const { settingUp, waiting } = latecomers(s);
  if (!settingUp.length && !waiting.length) return null;
  return (
    <p className={`latecomers ${className}`} role="status">
      {waiting.length > 0 && <span>{t.lateWaiting(waiting.join(", "))}</span>}
      {settingUp.length > 0 && <span>{t.lateSettingUp(settingUp.join(", "))}</span>}
    </p>
  );
}
