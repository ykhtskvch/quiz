// Phone: join → wait → answer → result. Host controls appear for the first player.
import { useEffect, useState } from "react";
import type { OptionKey, Snapshot } from "@quiz/shared";
import { NICKNAME_MAX } from "@quiz/shared";
import { api, ApiError, session, type PlayerSession } from "../api.ts";
import { t } from "../strings.ts";
import { useRoom } from "../useRoom.ts";

export function Player({ code }: { code: string }) {
  const [me, setMe] = useState<PlayerSession | null>(() => session.load(code));
  const { snapshot, status } = useRoom(code, me?.playerToken ?? null);

  useEffect(() => {
    if (status === "unauthorized") {
      session.clear(code);
      setMe(null);
    }
  }, [status, code]);

  useWakeLock(Boolean(me));

  if (status === "not-found") return <main className="center">{t.roomNotFound}</main>;
  if (!me) return <JoinForm code={code} onJoined={setMe} />;
  if (!snapshot || snapshot.you.role !== "player") return <main className="center muted">…</main>;

  return (
    <main className="player">
      {status === "reconnecting" && <div className="banner">{t.reconnecting}</div>}
      <header className="player-header">
        <span>{snapshot.you.nickname}</span>
        <span className="muted">{code}</span>
      </header>
      <PlayerBody s={snapshot} code={code} token={me.playerToken} />
    </main>
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: PlayerSession) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(code, name);
      const s = { playerId: r.playerId, playerToken: r.playerToken };
      session.save(code, s);
      onJoined(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t.roomNotFound : t.errorGeneric);
      setBusy(false);
    }
  };

  return (
    <main className="player center">
      <form className="join-form" onSubmit={submit}>
        <p className="muted">{t.roomCode}: {code}</p>
        <label htmlFor="name">{t.yourName}</label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.namePlaceholder}
          maxLength={NICKNAME_MAX}
          autoFocus
          autoComplete="nickname"
        />
        <button className="primary big" type="submit" disabled={busy || !name.trim()}>
          {busy ? t.joining : t.join}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}

function PlayerBody({ s, code, token }: { s: Snapshot; code: string; token: string }) {
  const isHost = s.you.role === "player" && s.you.isHost;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  const q = s.question;
  const enoughPlayers = s.room.players.length >= 2;

  if (!q) {
    return (
      <section className="center grow">
        <p>{isHost ? t.youAreHost : t.waitingForHost}</p>
        <p className="muted">
          {t.players}: {s.room.players.length}
        </p>
        {isHost && (
          <button className="primary big" disabled={busy || !enoughPlayers} onClick={() => run(() => api.start(code, token))}>
            {t.start}
          </button>
        )}
        {isHost && !enoughPlayers && <p className="muted small">{t.needTwoPlayers}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  if (q.phase === "ANSWERING") {
    const mine = s.mine?.answer ?? null;
    return (
      <section className="grow answer-section">
        <p className="muted small">{t.lookAtScreen}</p>
        <div className="answer-grid">
          {q.options.map((o) => (
            <button
              key={o.key}
              className={`answer ${mine === o.key ? "chosen" : ""}`}
              disabled={Boolean(mine) || busy}
              onClick={() => run(() => api.answer(code, token, o.key as OptionKey))}
            >
              <span className="key">{o.key}</span>
              <span className="text">{o.text}</span>
            </button>
          ))}
        </div>
        {mine && (
          <p className="center-text">
            {t.answerAccepted}: <strong>{mine}</strong>. {t.waitForOthers}
          </p>
        )}
        {isHost && (
          <button className="secondary" disabled={busy} onClick={() => run(() => api.reveal(code, token))}>
            {t.revealNow}
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  const correctKey = s.reveal?.correctKey;
  const result = s.mine?.answer == null ? "none" : s.mine.correct ? "right" : "wrong";
  return (
    <section className={`center grow result ${result}`}>
      <p className="result-title">{result === "right" ? t.correct : result === "wrong" ? t.wrong : t.noAnswer}</p>
      {correctKey && (
        <p className="muted">
          {t.correctAnswer}: {correctKey} — {q.options.find((o) => o.key === correctKey)?.text}
        </p>
      )}
      {isHost && (
        <button className="primary" disabled={busy} onClick={() => run(() => api.start(code, token))}>
          {t.nextDemo}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** Keeps the phone screen on during the game (needs a secure context; silently skipped otherwise). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState === "visible") {
        navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
      }
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
