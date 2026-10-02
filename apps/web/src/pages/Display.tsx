// Shared screen: lobby with QR, question, reveal. Read-only — it never sends commands.
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { OptionKey, Snapshot } from "@quiz/shared";
import { t } from "../strings.ts";
import { useRoom } from "../useRoom.ts";

declare const __LAN_ORIGIN__: string;

export function Display({ code }: { code: string }) {
  const token = useMemo(() => new URLSearchParams(location.hash.slice(1)).get("t"), []);
  const { snapshot, status } = useRoom(code, token);

  if (!token || status === "unauthorized") return <main className="center">{t.displayNoToken}</main>;
  if (status === "not-found") return <main className="center">{t.roomNotFound}</main>;
  if (!snapshot) return <main className="center muted">…</main>;

  return (
    <main className="display">
      {status === "reconnecting" && <div className="banner">{t.reconnecting}</div>}
      {snapshot.question ? <QuestionView s={snapshot} /> : <Lobby code={code} s={snapshot} />}
    </main>
  );
}

function joinOrigin() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return local ? __LAN_ORIGIN__ : location.origin;
}

function Lobby({ code, s }: { code: string; s: Snapshot }) {
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
          {t.players} · {s.room.players.length}
        </h2>
        {s.room.players.length === 0 ? (
          <p className="muted">{t.noPlayersYet}</p>
        ) : (
          <ul className="players">
            {s.room.players.map((p) => (
              <li key={p.id} className={p.connected ? "" : "offline"}>
                {p.nickname}
                {p.isHost && <span className="tag">{t.host}</span>}
                {!p.connected && <span className="tag muted">{t.offline}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">{t.hostHint}</p>
      </section>
    </div>
  );
}

function QuestionView({ s }: { s: Snapshot }) {
  const q = s.question!;
  const reveal = s.reveal;
  const total = reveal ? Object.values(reveal.distribution).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="question-view">
      <p className="muted">{t.question(q.number)}</p>
      <h1 className="question-text">{q.text}</h1>
      <ol className="options">
        {q.options.map((o) => {
          const isCorrect = reveal?.correctKey === o.key;
          const votes = reveal?.distribution[o.key as OptionKey] ?? 0;
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
      {reveal ? <p className="explanation">{reveal.explanation}</p> : <p className="counter">{t.answered(q.answered, q.activePlayers)}</p>}
    </div>
  );
}
