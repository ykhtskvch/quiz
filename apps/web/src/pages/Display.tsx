// Shared screen: lobby with QR, question phases, reveal, final results. Read-only — it never sends commands.
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { GameResults, Snapshot } from "@quiz/shared";
import { PhaseBar, StatCards } from "../components.tsx";
import { setLanguage, useT } from "../strings.ts";
import { useRoom } from "../useRoom.ts";

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
      {s.game && <footer className="display-footer muted">{code}</footer>}
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
                {p.nickname}
                {p.isHost && <span className="tag">{t.host}</span>}
                {!p.ready && p.status !== "DISCONNECTED" && <span className="tag muted">{t.chipOnboarding}</span>}
                {p.status === "DISCONNECTED" && <span className="tag muted">{t.offline}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t.hostHint}</p>
      </section>
    </div>
  );
}

function QuestionView({ s, timingAt }: { s: Snapshot; timingAt: number }) {
  const t = useT();
  const q = s.question!;
  const reveal = s.reveal;
  const total = reveal ? Object.values(reveal.distribution).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="question-view">
      <div className="question-head">
        <p className="muted">{t.question(q.number)}</p>
        {q.phase === "ANSWERING" && <p className="counter">{t.answered(q.answered, q.activePlayers)}</p>}
      </div>
      <h1 className="question-text">{q.text}</h1>
      {q.phase === "PRESENTING" && <p className="muted">{t.reading}</p>}
      {q.options && (
        <ol className="options">
          {q.options.map((o) => {
            const isCorrect = reveal?.correctKey === o.key;
            const votes = reveal?.distribution[o.key] ?? 0;
            return (
              <li key={o.key} className={reveal ? (isCorrect ? "correct" : "dim") : ""}>
                <span className="key">{o.key}</span>
                <span className="text">{o.text}</span>
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
      )}
      {reveal && <p className="explanation">{reveal.explanation}</p>}
      <PhaseBar timing={q.timing} timingAt={timingAt} showSeconds={q.phase === "ANSWERING"} />
    </div>
  );
}

function Results({ results }: { results: GameResults }) {
  const t = useT();
  const [winner, ...rest] = results.leaderboard;
  return (
    <div className="results">
      <p className="muted">
        {t.results} · {t.questionsPlayed(results.questionsPlayed)}
      </p>
      {winner && (
        <div className="winner">
          <p className="muted">{t.winner}</p>
          <p className="winner-name">{winner.nickname}</p>
          <p className="winner-score">{t.score(winner.score)}</p>
        </div>
      )}
      <ol className="leaderboard" start={2}>
        {rest.map((l) => (
          <li key={l.playerId}>
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
