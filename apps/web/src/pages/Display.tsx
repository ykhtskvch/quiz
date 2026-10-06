// Shared screen: lobby with QR, question phases, reveal, final results. Read-only — it never sends commands.
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { DEFAULT_CONFIG, type GameResults, type Snapshot } from "@quiz/shared";
import { AnswerTimer, BetaBadge, NextUp, placeOf, StatCards } from "../components.tsx";
import { setLanguage, useT } from "../strings.ts";
import { useCountdown, useRoom } from "../useRoom.ts";

declare const __LAN_ORIGIN__: string;

export function Display({ code }: { code: string }) {
  const t = useT();
  const token = useMemo(() => new URLSearchParams(location.hash.slice(1)).get("t"), []);
  const { snapshot: s, status, timingAt } = useRoom(code, token);
  const roomLanguage = s?.room.language;
  useEffect(() => {
    if (roomLanguage) setLanguage(roomLanguage);
  }, [roomLanguage]);

  if (!token || status === "unauthorized") return <main className="center">{t.displayNoToken}</main>;
  if (status === "not-found") return <main className="center">{t.roomNotFound}</main>;
  if (!s) return <main className="center muted">…</main>;

  const paused = s.game?.status === "PAUSED";
  return (
    <main className="display">
      {status === "reconnecting" && <div className="banner">{t.reconnecting}</div>}
      {paused && <div className="pause-overlay">{t.paused}</div>}
      {!s.game ? (
        <Lobby code={code} s={s} />
      ) : s.results ? (
        <Results results={s.results} />
      ) : s.question ? (
        <QuestionView s={s} timingAt={timingAt} />
      ) : (
        <div className="center muted big-text">{t.nextQuestion}</div>
      )}
      {s.game && (
        <footer className="display-footer muted">
          {t.appName} · {code}
        </footer>
      )}
    </main>
  );
}

function joinOrigin() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return local ? __LAN_ORIGIN__ : location.origin;
}

function Lobby({ code, s }: { code: string; s: Snapshot }) {
  const t = useT();
  const joinUrl = `${joinOrigin()}/j/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 640, color: { dark: "#16131f", light: "#ffffff" } }).then(setQr);
  }, [joinUrl]);

  return (
    <div className="lobby">
      <section className="qr-panel">
        <p className="brand-mark display-brand">{t.appName}</p>
        <h2>{t.scanToJoin}</h2>
        {qr && <img className="qr" src={qr} alt={joinUrl} />}
        <p className="muted">
          {t.orOpen} <strong>{joinOrigin().replace(/^https?:\/\//, "")}</strong> {t.andEnterCode}
        </p>
        <p className="room-code">{code}</p>
      </section>
      <section className="players-panel">
        <h2>
          {t.players} · {t.readyCount(s.room.players.filter((p) => p.ready).length, s.room.players.length)}
        </h2>
        {s.room.players.length === 0 ? (
          <p className="muted">{t.noPlayersYet}</p>
        ) : (
          <ul className="players">
            {s.room.players.map((p) => (
              <li key={p.id} className={p.status === "DISCONNECTED" ? "offline" : p.ready ? "ready" : "filling"}>
                {p.ready && <span aria-hidden>✓</span>}
                <span className="player-name">{p.nickname}</span>
                {p.isHost && <span className="tag">{t.host}</span>}
                {!p.ready && p.status !== "DISCONNECTED" && <span className="tag muted">{t.chipOnboarding}</span>}
                {p.status === "DISCONNECTED" && <span className="tag muted">{t.offline}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="lobby-next">{lobbyNext(s, t)}</p>
        <p className="lobby-rules">{t.rulesShort(DEFAULT_CONFIG.questionsPerGame)}</p>
        <BetaBadge group />
      </section>
    </div>
  );
}

const KEYS = ["A", "B", "C", "D"] as const;

/**
 * Fixed stage (playtest 1): the question stays put at the top, the four option slots are reserved
 * from the start and fill in when answering opens, and the bottom slot holds the timer, then the
 * correct answer. Nothing moves between phases, so eyes stay where they were.
 */
/** What the room is waiting for, named — instead of a fixed instruction (DS-041). */
function lobbyNext(s: Snapshot, t: ReturnType<typeof useT>): string {
  const players = s.room.players;
  const host = players.find((p) => p.isHost);
  if (!host) return t.hostHint;
  const ready = players.filter((p) => p.ready).length;
  const prefix = `${t.hostIs(host.nickname)} · `;
  if (ready < 2) return prefix + t.displayNeedPlayers;
  if (players.some((p) => !p.ready && p.status !== "DISCONNECTED")) return prefix + t.displayWaitSetup;
  return prefix + t.displayCanStart;
}

function QuestionView({ s, timingAt }: { s: Snapshot; timingAt: number }) {
  const t = useT();
  const q = s.question!;
  const reveal = s.reveal;
  const total = reveal ? Object.values(reveal.distribution).reduce((a, b) => a + b, 0) : 0;
  const correct = reveal ? q.options?.find((o) => o.key === reveal.correctKey) : undefined;
  const questionsTotal = s.game?.totalQuestions ?? q.number;
  // Reveal in two beats (playtest 1): the answer first, then "Did you know?" with the explanation.
  const remaining = useCountdown(q.timing, timingAt);
  const revealElapsed = reveal && q.timing && remaining !== null ? q.timing.durationMs - remaining : 0;
  const showFact = Boolean(reveal?.explanation) && revealElapsed >= DEFAULT_CONFIG.revealFactAfterMs;

  return (
    <div className="question-view">
      <div className="question-head">
        <p className="muted">{t.question(q.number, questionsTotal)}</p>
        {q.phase === "ANSWERING" && <p className="counter">{t.answered(q.answered, q.activePlayers)}</p>}
        {reveal && <NextUp timing={q.timing} timingAt={timingAt} number={q.number} total={questionsTotal} />}
      </div>
      <h1 className="question-text">{q.text}</h1>
      {showFact && correct ? (
        <div className="did-you-know">
          <p className="dyk-label">{t.didYouKnow}</p>
          <p className="dyk-text">{reveal!.explanation}</p>
          <p className="dyk-answer">
            {t.correctAnswer}: <span className="key">{correct.key}</span> {correct.text}
          </p>
        </div>
      ) : (
        <>
          <ol className="options">
            {KEYS.map((key) => {
              const o = q.options?.find((x) => x.key === key);
              const isCorrect = reveal?.correctKey === key;
              const votes = reveal?.distribution[key] ?? 0;
              return (
                <li key={key} className={!o ? "pending" : reveal ? (isCorrect ? "correct" : "dim") : ""}>
                  <span className="key">{key}</span>
                  <span className="text">{o?.text ?? ""}</span>
                  {reveal && (
                    <span className="votes">
                      <span className="bar" style={{ width: total ? `${(votes / total) * 100}%` : 0 }} />
                      {votes}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="stage-foot">
            {q.phase === "PRESENTING" && <p className="muted reading">{t.reading}</p>}
            {q.phase === "ANSWERING" && <AnswerTimer timing={q.timing} timingAt={timingAt} />}
            {reveal && correct && (
              <div className="reveal-banner">
                <p className="reveal-label">{t.correctAnswer}</p>
                <p className="reveal-answer">
                  <span className="key">{correct.key}</span> {correct.text}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Results({ results }: { results: GameResults }) {
  const t = useT();
  const board = results.leaderboard;
  // Everyone tied for the top score is a winner; the rest keep shared places for ties.
  const winners = board.filter((l, i) => placeOf(board, i) === 1);
  const rest = board.filter((l, i) => placeOf(board, i) > 1);
  return (
    <div className="results">
      <p className="muted">
        {t.results} · {t.questionsPlayed(results.questionsPlayed)}
      </p>
      {winners.length > 0 && (
        <div className="winner">
          <p className="muted">{winners.length > 1 ? t.winners : t.winner}</p>
          <p className="winner-name">{winners.map((w) => w.nickname).join(" · ")}</p>
          <p className="winner-score">{t.score(winners[0].score)}</p>
        </div>
      )}
      <ol className="leaderboard">
        {rest.map((l) => (
          <li key={l.playerId} value={placeOf(board, board.indexOf(l))}>
            <span className="name">{l.nickname}</span>
            <span className="muted">{t.correctOf(l.correct, l.attempted)}</span>
            <span className="score">{t.score(l.score)}</span>
          </li>
        ))}
      </ol>
      <StatCards results={results} />
      <p className="muted small">{t.waitPlayAgain}</p>
    </div>
  );
}
