// Phone: join → wait → answer → result → final place. Host controls appear for the first player.
import { useEffect, useRef, useState } from "react";
import type { HostCommand, OnboardingInput, OptionKey, QuestionRating, Snapshot } from "@quiz/shared";
import { DEFAULT_CONFIG, NICKNAME_MAX } from "@quiz/shared";
import { api, ApiError, session, type PlayerSession } from "../api.ts";
import { navigate } from "../router.ts";
import { AnswerTimer, NextUp, placeOf } from "../components.tsx";
import { QuestionRatings, SessionFeedback } from "./Feedback.tsx";
import { Onboarding } from "./Onboarding.tsx";
import { setLanguage, useT } from "../strings.ts";
import { useRoom } from "../useRoom.ts";

export function Player({ code }: { code: string }) {
  const t = useT();
  const [me, setMe] = useState<PlayerSession | null>(() => session.load(code));
  const { snapshot, status, timingAt } = useRoom(code, me?.playerToken ?? null);
  const [editing, setEditing] = useState(false);
  // Offboarding progress per game number. Kept here, above the screens: editing preferences unmounts
  // the results screen, and coming back must not show an already-sent form again.
  const [sentInGame, setSentInGame] = useState<number | null>(null);
  const [ratingInGame, setRatingInGame] = useState<number | null>(null);
  // Ratings given right on the reveal, keyed "game:question" — so the end-of-game list only asks
  // about the questions this player hasn't rated yet.
  const [rated, setRated] = useState<Record<string, QuestionRating>>({});
  const rate = (game: number, number: number, rating: QuestionRating) => {
    const key = `${game}:${number}`;
    // Changeable until the reveal ends (PT2, DS-062); a failed send puts the previous choice back.
    const previous = rated[key];
    if (previous === rating || !me) return;
    setRated((r) => ({ ...r, [key]: rating }));
    api.rateQuestion(code, me.playerToken, number, rating).catch(() =>
      setRated((r) => {
        const copy = { ...r };
        if (previous) copy[key] = previous;
        else delete copy[key];
        return copy;
      }),
    );
  };
  // Own answers are never broadcast, so the snapshot only has them after a reconnect; keep the last submission.
  const [submitted, setSubmitted] = useState<OnboardingInput | null>(null);

  // Learn the room's language (and which topics have content in it) before joining — and find out
  // early if the room is gone, before anyone types a name (DS-021).
  const [topics, setTopics] = useState<string[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api
      .roomInfo(code)
      .then((info) => {
        setLanguage(info.language);
        setTopics(info.topics);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        setTopics([]);
      });
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

  if (status === "not-found" || (missing && !me)) return <RoomNotFound />;
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
        <PlayerBody
          s={snapshot}
          code={code}
          token={me.playerToken}
          timingAt={timingAt}
          onEdit={() => setEditing(true)}
          offboarding={{ sentInGame, setSentInGame, ratingInGame, setRatingInGame }}
          rated={rated}
          onRate={rate}
        />
      )}
    </main>
  );
}

/** A dead or mistyped room link is not a dead end: say what happened and offer another code. */
function RoomNotFound() {
  const t = useT();
  return (
    <main className="player center">
      <p className="brand-mark">{t.appName}</p>
      <p className="notice" role="alert">
        {t.roomNotFound}
      </p>
      <button className="primary big" onClick={() => navigate("/#join")}>
        {t.enterAnotherCode}
      </button>
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
      // A failed request without a status is the network, not a missing room (DS-021).
      const httpStatus = err instanceof ApiError ? err.status : 0;
      setError(
        httpStatus === 404 ? t.roomNotFound : httpStatus === 429 ? t.tooManyRequests : httpStatus === 0 ? t.networkError : t.errorGeneric,
      );
      setBusy(false);
    }
  };

  return (
    <main className="player center">
      <form className="join-form" onSubmit={submit}>
        <p className="brand-mark">{t.appName}</p>
        <h1 className="join-heading">{t.joinHeading}</h1>
        <p className="muted">
          {t.roomCode}: <strong>{code}</strong>
        </p>
        <p className="hint">{t.joinHint}</p>
        <label htmlFor="name" className="field-label">
          {t.yourName}
        </label>
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
        <p className="error form-error" role="alert">
          {error ?? ""}
        </p>
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

type RateProps = {
  rated: Record<string, QuestionRating>;
  onRate: (game: number, number: number, rating: QuestionRating) => void;
};

type Offboarding = {
  sentInGame: number | null;
  setSentInGame: (n: number) => void;
  ratingInGame: number | null;
  setRatingInGame: (n: number) => void;
};

function PlayerBody({
  s,
  code,
  token,
  timingAt,
  onEdit,
  offboarding,
  rated,
  onRate,
}: {
  s: Snapshot;
  code: string;
  token: string;
  timingAt: number;
  onEdit: () => void;
  offboarding: Offboarding;
} & RateProps) {
  const t = useT();
  const isHost = s.you.role === "player" && s.you.isHost;
  const cmd = useCommand(code, token);
  const game = s.game;
  // Per game number, so a new game starts with a fresh form.
  const { sentInGame, setSentInGame, ratingInGame, setRatingInGame } = offboarding;
  const feedbackSent = Boolean(s.mine?.feedbackGiven) || (game !== null && sentInGame === game.number);
  const rating = game !== null && ratingInGame === game.number;

  // ---- lobby: one status block — role, readiness, the next step (DS-042, DS-043) ----
  if (!game) {
    const ready = s.room.players.filter((p) => p.ready).length;
    const settingUp = s.room.players.filter((p) => !p.ready && p.status !== "DISCONNECTED").length;
    const enough = ready >= 2;
    const hostName = s.room.players.find((p) => p.isHost)?.nickname;
    return (
      <section className="grow lobby-phone">
        <div className="lobby-status">
          <p className="lobby-role">{isHost ? t.youAreHostLong : hostName ? t.waitingForName(hostName) : t.waitingForHost}</p>
          <p className="muted">{t.readyCount(ready, s.room.players.length)}</p>
          {isHost && enough && settingUp > 0 && <p className="hint">{t.othersSettingUp(settingUp)}</p>}
        </div>
        {isHost && (
          <div className="lobby-action">
            <button className="primary big" disabled={cmd.busy || !enough} onClick={() => cmd.host("start")}>
              {t.start}
            </button>
            {!enough && <p className="hint">{t.needOneMore}</p>}
          </div>
        )}
        <div className="rules">
          <p>{t.rulesShort(DEFAULT_CONFIG.questionsPerGame)}</p>
          <details>
            <summary>{t.scoringTitle}</summary>
            <p className="hint">{t.scoringRules}</p>
          </details>
        </div>
        <button className="link" onClick={onEdit}>
          {t.editPrefs}
        </button>
        {cmd.error && (
          <p className="error" role="alert">
            {cmd.error}
          </p>
        )}
      </section>
    );
  }

  // ---- finished: place, offboarding, ratings, play again ----
  if (s.results) {
    // Ratings from the reveal (this session) plus any the server already has (after a reconnect).
    const myRatings: Record<number, QuestionRating> = { ...(s.mine?.ratings ?? {}) };
    for (const [key, r] of Object.entries(rated)) {
      const [gameNo, number] = key.split(":").map(Number);
      if (game && gameNo === game.number) myRatings[number] = r;
    }
    const unrated = s.results.questions.filter((q) => !myRatings[q.number]);
    const myIndex = s.results.leaderboard.findIndex((l) => s.you.role === "player" && l.playerId === s.you.playerId);
    const mine = s.results.leaderboard[myIndex];
    const place = placeOf(s.results.leaderboard, myIndex);
    return (
      <div className="finished">
        <section className="center-text">
          <p className="brand-mark">{t.appName}</p>
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
            {!rating && unrated.length > 0 && (
              <div className="rate-offer">
                <p>{t.rateOffer}</p>
                <button onClick={() => game && setRatingInGame(game.number)}>{t.rateOfferButton}</button>
              </div>
            )}
          </section>
        )}
        {mine && feedbackSent && rating && unrated.length > 0 && (
          <QuestionRatings code={code} token={token} results={{ ...s.results, questions: unrated }} initial={myRatings} />
        )}
        <section className="center-text finished-actions">
          {isHost && <PlayAgain busy={cmd.busy} onConfirm={() => cmd.host("play-again")} />}
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
      <QuestionBody s={s} code={code} token={token} timingAt={timingAt} run={cmd.run} busy={cmd.busy} rated={rated} onRate={onRate} />
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
  rated,
  onRate,
}: {
  s: Snapshot;
  code: string;
  token: string;
  timingAt: number;
  run: (f: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
} & RateProps) {
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
          {s.game && <QuickRate rating={rated[`${s.game.number}:${q.number}`] ?? s.mine?.ratings[q.number]} onRate={(r) => onRate(s.game!.number, q.number, r)} />}
          <NextUp timing={q.timing} timingAt={timingAt} number={q.number} total={total} />
        </div>
      ) : (
        <>
          <AnswerGrid key={`${s.game?.number}:${q.number}`} s={s} code={code} token={token} paused={paused} />
          {q.phase === "PRESENTING" && <p className="muted center-text">{t.reading}</p>}
        </>
      )}
    </section>
  );
}

/**
 * Options on the phone (PT2). A tap shows "sending…" at once and is retried through a reconnect, so a
 * lost request can't look like an accepted answer; another option replaces the answer until time runs
 * out (DS-D2). Keyed by question, so nothing carries over to the next one.
 */
function AnswerGrid({ s, code, token, paused }: { s: Snapshot; code: string; token: string; paused: boolean }) {
  const t = useT();
  const q = s.question!;
  const mine = s.mine?.answer ?? null;
  const [sending, setSending] = useState<OptionKey | null>(null);
  const [failed, setFailed] = useState<"network" | "closed" | null>(null);
  const attempt = useRef(0);

  const send = async (key: OptionKey) => {
    const my = ++attempt.current;
    setSending(key);
    setFailed(null);
    for (let i = 0; i < 4; i++) {
      try {
        await api.answer(code, token, key);
        if (my === attempt.current) setSending(null);
        return;
      } catch (e) {
        if (my !== attempt.current) return;
        const retry = !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
        if (!retry) {
          setSending(null);
          setFailed(e.status === 409 ? "closed" : "network");
          return;
        }
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    if (my === attempt.current) {
      setSending(null);
      setFailed("network");
    }
  };

  const shown = sending ?? mine;
  const everyone = q.phase === "ANSWERING" && q.activePlayers > 0 && q.answered >= q.activePlayers;
  return (
    <>
      <div className="answer-grid">
        {(["A", "B", "C", "D"] as const).map((key) => {
          const o = q.options?.find((x) => x.key === key);
          return (
            <button
              key={key}
              className={`answer ${!o ? "pending" : ""} ${shown === key ? "chosen" : ""} ${sending === key ? "sending" : ""}`}
              aria-pressed={shown === key}
              disabled={!o || paused || q.phase !== "ANSWERING"}
              onClick={() => key !== shown && send(key)}
            >
              <span className="key">{key}</span>
              <span className="text">{o?.text ?? ""}</span>
            </button>
          );
        })}
      </div>
      <p className="answer-status center-text" role="status">
        {sending ? (
          t.answerSending
        ) : failed ? (
          <span className="error">{failed === "closed" ? t.answerTooLate : t.answerNotSent}</span>
        ) : mine ? (
          <>
            {t.answerAccepted}: <strong>{mine}</strong>. {everyone ? t.everyoneAnswered : t.canChangeAnswer}
          </>
        ) : (
          ""
        )}
      </p>
    </>
  );
}

/**
 * 👍 / 👎 right on the reveal: optional, one tap (06.10). The choice stays lit and can be changed
 * (PT2, DS-062). "Fine" stays for the end list.
 */
function QuickRate({ rating, onRate }: { rating: QuestionRating | undefined; onRate: (r: QuestionRating) => void }) {
  const t = useT();
  return (
    <div className="quick-rate-wrap">
      <div className="quick-rate" role="group" aria-label={t.quickRateLabel}>
        {(["GREAT", "BAD"] as QuestionRating[]).map((r) => (
          <button key={r} className={rating === r ? "on" : ""} aria-pressed={rating === r} aria-label={t.rating[r].label} onClick={() => onRate(r)}>
            {t.rating[r].icon}
          </button>
        ))}
      </div>
      <p className="quick-rate-done muted" role="status">
        {rating ? t.quickRateThanks : ""}
      </p>
    </div>
  );
}

/**
 * PT2: "Play again" was taken for the form's send button and restarted the room. It sits in its own
 * block for the host, looks secondary and asks once more, like "End".
 */
function PlayAgain({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(id);
  }, [confirm]);
  return (
    <div className="play-again">
      <p className="muted small">{t.hostNextGame}</p>
      <button className="secondary big" disabled={busy} onClick={() => (confirm ? onConfirm() : setConfirm(true))}>
        {confirm ? t.confirmPlayAgain : t.playAgain}
      </button>
    </div>
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
