// Phone: join → wait → answer → result → final place. Host controls appear for the first player.
import { useEffect, useState } from "react";
import type { HostCommand, OnboardingInput, OptionKey, Snapshot } from "@quiz/shared";
import { DEFAULT_CONFIG, NICKNAME_MAX } from "@quiz/shared";
import { api, ApiError, session, type PlayerSession } from "../api.ts";
import { AnswerTimer, NextUp } from "../components.tsx";
import { QuestionRatings, SessionFeedback } from "./Feedback.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { setLanguage, useT } from "../strings.ts";
import { useRoom } from "../useRoom.ts";

export function Player({ code }: { code: string }) {
  const t = useT();
  const [me, setMe] = useState<PlayerSession | null>(() => session.load(code));
  const { snapshot, status, timingAt } = useRoom(code, me?.playerToken ?? null);
  const [editing, setEditing] = useState(false);
  // Own answers are never broadcast, so the snapshot only has them after a reconnect; keep the last submission.
  const [submitted, setSubmitted] = useState<OnboardingInput | null>(null);

  // Learn the room's language (and which topics have content in it) before joining.
  const [topics, setTopics] = useState<string[] | null>(null);
  useEffect(() => {
    api
      .roomInfo(code)
      .then((info) => {
        setLanguage(info.language);
        setTopics(info.topics);
      })
      .catch(() => setTopics([]));
  }, [code]);
  const roomLanguage = snapshot?.room.language;
  useEffect(() => {
    if (roomLanguage) setLanguage(roomLanguage);
  }, [roomLanguage]);

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

  const you = snapshot.you;
  const between = !snapshot.game || snapshot.game.status === "FINISHED";
  const onboarding = you.status === "ONBOARDING" || (editing && between);

  return (
    <main className="player">
      {status === "reconnecting" && <div className="banner">{t.reconnecting}</div>}
      <header className="player-header">
        <span>{you.nickname}</span>
        <span className="muted">{snapshot.mine && snapshot.game && !onboarding ? t.total(snapshot.mine.total) : code}</span>
      </header>
      {onboarding ? (
        <Onboarding
          code={code}
          token={me.playerToken}
          initial={submitted ?? you.onboarding}
          availableTopics={topics}
          onDone={(input) => {
            setSubmitted(input);
            setEditing(false);
          }}
          onCancel={you.status === "ONBOARDING" ? undefined : () => setEditing(false)}
        />
      ) : (
        <PlayerBody s={snapshot} code={code} token={me.playerToken} timingAt={timingAt} onEdit={() => setEditing(true)} />
      )}
    </main>
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (s: PlayerSession) => void }) {
  const t = useT();
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
      const httpStatus = err instanceof ApiError ? err.status : 0;
      setError(httpStatus === 404 ? t.roomNotFound : httpStatus === 429 ? t.tooManyRequests : t.errorGeneric);
      setBusy(false);
    }
  };

  return (
    <main className="player center">
      <form className="join-form" onSubmit={submit}>
        <p className="muted">
          {t.roomCode}: {code}
        </p>
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

function useCommand(code: string, token: string) {
  const t = useT();
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
  const host = (command: HostCommand) => run(() => api.host(code, token, command));
  return { busy, error, run, host };
}

function PlayerBody({ s, code, token, timingAt, onEdit }: { s: Snapshot; code: string; token: string; timingAt: number; onEdit: () => void }) {
  const t = useT();
  const isHost = s.you.role === "player" && s.you.isHost;
  const cmd = useCommand(code, token);
  const game = s.game;
  // Per game number, so a new game starts with a fresh form.
  const [sentInGame, setSentInGame] = useState<number | null>(null);
  const [ratingInGame, setRatingInGame] = useState<number | null>(null);
  const feedbackSent = Boolean(s.mine?.feedbackGiven) || (game !== null && sentInGame === game.number);
  const rating = game !== null && ratingInGame === game.number;

  // ---- lobby ----
  if (!game) {
    const ready = s.room.players.filter((p) => p.ready).length;
    const enough = ready >= 2;
    return (
      <section className="center grow">
        <p className="big-text">{t.readyWait}</p>
        <p>{isHost ? t.youAreHost : t.waitingForHost}</p>
        <p className="muted">{t.readyCount(ready, s.room.players.length)}</p>
        <p className="muted small">
          {t.gameLength(DEFAULT_CONFIG.questionsPerGame)} {t.scoringRules}
        </p>
        {isHost && (
          <button className="primary big" disabled={cmd.busy || !enough} onClick={() => cmd.host("start")}>
            {t.start}
          </button>
        )}
        {isHost && !enough && <p className="muted small">{t.needTwoPlayers}</p>}
        {isHost && enough && ready < s.room.players.length && <p className="muted small">{t.stragglersHint}</p>}
        <button className="link" onClick={onEdit}>
          {t.editPrefs}
        </button>
        {cmd.error && <p className="error">{cmd.error}</p>}
      </section>
    );
  }

  // ---- finished: place, offboarding, ratings, play again ----
  if (s.results) {
    const place = s.results.leaderboard.findIndex((l) => s.you.role === "player" && l.playerId === s.you.playerId) + 1;
    const mine = s.results.leaderboard[place - 1];
    return (
      <div className="finished">
        <section className="center-text">
          <p className="muted results-label">{t.results}</p>
          {mine && (
            <p className="place">
              {t.place(place)} <span className="place-of">({t.placeOf(s.results.leaderboard.length)})</span>
            </p>
          )}
          {mine && (
            <p className="place-stats">
              <span>{t.score(mine.score)}</span>
              <span>{t.correctOf(mine.correct, mine.attempted)}</span>
            </p>
          )}
        </section>
        {mine && !feedbackSent && <SessionFeedback code={code} token={token} onSent={() => game && setSentInGame(game.number)} />}
        {mine && feedbackSent && (
          <section className="after-feedback">
            <p className="thanks">{t.feedbackThanks}</p>
            {!isHost && <p className="muted center-text">{t.waitHostNewGame}</p>}
            {!rating && s.results.questions.length > 0 && (
              <div className="rate-offer">
                <p>{t.rateOffer}</p>
                <button onClick={() => game && setRatingInGame(game.number)}>{t.rateOfferButton}</button>
              </div>
            )}
          </section>
        )}
        {mine && feedbackSent && rating && <QuestionRatings code={code} token={token} results={s.results} initial={s.mine?.ratings ?? {}} />}
        <section className="center-text finished-actions">
          {isHost && (
            <button className="primary big" disabled={cmd.busy} onClick={() => cmd.host("play-again")}>
              {t.playAgain}
            </button>
          )}
          {/* Changing interests is about the next game, so it comes after the form (playtest 1). */}
          {(feedbackSent || !mine) && (
            <button className="link" onClick={onEdit}>
              {t.editPrefs}
            </button>
          )}
          {cmd.error && <p className="error">{cmd.error}</p>}
        </section>
      </div>
    );
  }

  return (
    <>
      {game.status === "PAUSED" && <div className="paused-chip">{t.paused}</div>}
      <QuestionBody s={s} code={code} token={token} timingAt={timingAt} run={cmd.run} busy={cmd.busy} />
      {cmd.error && <p className="error center-text">{cmd.error}</p>}
      {isHost && <HostBar s={s} host={cmd.host} busy={cmd.busy} />}
    </>
  );
}

function QuestionBody({
  s,
  code,
  token,
  timingAt,
  run,
  busy,
}: {
  s: Snapshot;
  code: string;
  token: string;
  timingAt: number;
  run: (f: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const t = useT();
  const q = s.question;
  if (s.you.role === "player" && s.you.status === "PENDING") {
    return <section className="center grow">{t.pendingJoin}</section>;
  }
  if (!q) return <section className="center grow muted">{t.nextQuestion}</section>;

  // Fixed layout (playtest 1): the question stays on top in every phase; the timer slot and the
  // option area are always there, so nothing jumps when answering opens or the answer is revealed.
  const total = s.game?.totalQuestions ?? q.number;
  const mine = s.mine?.answer ?? null;
  const paused = s.game?.status === "PAUSED";
  const r = s.mine?.result;
  const correct = q.options?.find((o) => o.key === s.reveal?.correctKey);
  const kind = !r ? "none" : r.correct ? "right" : "wrong";

  return (
    <section className="grow phone-stage">
      <p className="muted small">{t.question(q.number, total)}</p>
      <p className="phone-question">{q.text}</p>
      <div className="phone-timer">{q.phase === "ANSWERING" && <AnswerTimer timing={q.timing} timingAt={timingAt} />}</div>

      {q.phase === "REVEALED" ? (
        <div className={`result ${kind}`}>
          <p className="result-title">{kind === "right" ? t.correct : kind === "wrong" ? t.wrong : t.noAnswer}</p>
          {r?.correct && (
            <p className="points">
              {t.points(r.points)} <span className="tier">· {t.speedTier[speedTier(r.points)]}</span>
            </p>
          )}
          {correct && (
            <div className="reveal-banner">
              <p className="reveal-label">{t.correctAnswer}</p>
              <p className="reveal-answer">
                <span className="key">{correct.key}</span> {correct.text}
              </p>
            </div>
          )}
          <NextUp timing={q.timing} timingAt={timingAt} number={q.number} total={total} />
        </div>
      ) : (
        <>
          <div className="answer-grid">
            {(["A", "B", "C", "D"] as const).map((key) => {
              const o = q.options?.find((x) => x.key === key);
              return (
                <button
                  key={key}
                  className={`answer ${!o ? "pending" : ""} ${mine === key ? "chosen" : ""}`}
                  disabled={!o || Boolean(mine) || busy || paused}
                  onClick={() => run(() => api.answer(code, token, key as OptionKey))}
                >
                  <span className="key">{key}</span>
                  <span className="text">{o?.text ?? ""}</span>
                </button>
              );
            })}
          </div>
          {q.phase === "PRESENTING" && <p className="muted center-text">{t.reading}</p>}
          {mine && (
            <p className="center-text">
              {t.answerAccepted}: <strong>{mine}</strong>. {t.waitForOthers}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function HostBar({ s, host, busy }: { s: Snapshot; host: (c: HostCommand) => Promise<void>; busy: boolean }) {
  const t = useT();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [softDismissed, setSoftDismissed] = useState(false);
  useEffect(() => {
    if (!confirmEnd) return;
    const id = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(id);
  }, [confirmEnd]);

  const paused = s.game?.status === "PAUSED";
  const canSkip = !paused && (s.question?.phase === "PRESENTING" || s.question?.phase === "ANSWERING");

  return (
    <div className="host-bar">
      {s.game?.softEndSuggested && !softDismissed && (
        <div className="soft-end">
          <p>{t.softEnd}</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => host("end")}>
              {t.end}
            </button>
            <button onClick={() => setSoftDismissed(true)}>{t.softEndContinue}</button>
          </div>
        </div>
      )}
      <div className="row">
        <button disabled={busy} onClick={() => host(paused ? "resume" : "pause")}>
          {paused ? t.resume : t.pause}
        </button>
        <button disabled={busy || !canSkip} onClick={() => host("skip")}>
          {t.skip}
        </button>
        <button
          className={confirmEnd ? "danger" : ""}
          disabled={busy}
          onClick={() => (confirmEnd ? host("end") : setConfirmEnd(true))}
        >
          {confirmEnd ? t.confirmEnd : t.end}
        </button>
      </div>
    </div>
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

/** Which speed band a correct answer's points came from (GameConfig.points). */
function speedTier(points: number): "fast" | "mid" | "late" {
  const p = DEFAULT_CONFIG.points;
  return points >= p.fast ? "fast" : points >= p.mid ? "mid" : "late";
}
