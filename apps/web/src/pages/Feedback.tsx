// Post-game offboarding (EPIC 28) and per-question ratings (EPIC 29) on the phone.
// Two steps since playtest 1: the short form first, then question ratings as an opt-in.
import { useState } from "react";
import {
  BALANCE_RATINGS,
  DIFFICULTY_RATINGS,
  FEEDBACK_COMMENT_MAX,
  PACE_RATINGS,
  PLAY_AGAIN,
  QUESTION_RATINGS,
  type GameResults,
  type QuestionRating,
  type SessionFeedbackInput,
} from "@quiz/shared";
import { api } from "../api.ts";
import { useT } from "../strings.ts";

export function SessionFeedback({ code, token, onSent }: { code: string; token: string; onSent: () => void }) {
  const t = useT();
  const [form, setForm] = useState<Partial<SessionFeedbackInput>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = <K extends keyof SessionFeedbackInput>(key: K, label: string, values: readonly string[], labels: Record<string, string>) => (
    <div className="fb-row" key={key}>
      <p className="fb-label">{label}</p>
      <div className="segmented">
        {values.map((v) => (
          // Optional rows can be un-picked with a second tap; "play again" just switches.
          <button
            key={v}
            className={form[key] === v ? "on" : ""}
            aria-pressed={form[key] === v}
            onClick={() => setForm({ ...form, [key]: form[key] === v && key !== "playAgain" ? undefined : v })}
          >
            {labels[v]}
          </button>
        ))}
      </div>
    </div>
  );

  // P-08: only "play again" is required — a third of the players filled in the all-required form on
  // 10.10. The button stays grey until it is answered (PT2), the rest is optional.
  const complete = Boolean(form.playAgain);

  const submit = async () => {
    if (!complete) return;
    setBusy(true);
    setError(null);
    try {
      await api.feedback(code, token, form as SessionFeedbackInput);
      onSent();
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="feedback">
      <h2>{t.feedbackTitle}</h2>
      {row("playAgain", t.fbPlayAgain, PLAY_AGAIN, t.intent)}
      <p className="fb-optional muted">{t.fbOptional}</p>
      {row("difficulty", t.fbDifficulty, DIFFICULTY_RATINGS, t.fbDifficultyValues)}
      {row("pace", t.fbPace, PACE_RATINGS, t.fbPaceValues)}
      {row("culturalBalance", t.fbBalance, BALANCE_RATINGS, t.fbBalanceValues)}
      {row("differentGroup", t.fbDifferentGroup, PLAY_AGAIN, t.intent)}
      <div className="fb-row">
        <label className="fb-label" htmlFor="fb-comment">
          {t.fbComment}
        </label>
        <textarea
          id="fb-comment"
          rows={3}
          maxLength={FEEDBACK_COMMENT_MAX}
          placeholder={t.fbCommentPlaceholder}
          value={form.comment ?? ""}
          onChange={(e) => setForm({ ...form, comment: e.target.value })}
        />
      </div>
      <button className="primary big" disabled={!complete || busy} onClick={submit}>
        {complete ? t.send : t.fbNeedFirst}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted small fb-privacy">
        <a href="/privacy" target="_blank" rel="noopener">
          {t.privacyMore}
        </a>
      </p>
    </section>
  );
}

/** Playtest 1: a long list felt like a chore — show a few at a time. */
const RATINGS_PAGE = 5;

export function QuestionRatings({
  code,
  token,
  results,
  initial,
}: {
  code: string;
  token: string;
  results: GameResults;
  initial: Record<number, QuestionRating>;
}) {
  const t = useT();
  const [ratings, setRatings] = useState<Record<number, QuestionRating>>(initial);
  const [shown, setShown] = useState(RATINGS_PAGE);
  if (results.questions.length === 0) return null;
  const hidden = results.questions.length - shown;

  const rate = async (number: number, rating: QuestionRating) => {
    // Changeable (PT2, DS-062); a failed send puts the previous choice back.
    const previous = ratings[number];
    if (previous === rating) return;
    setRatings({ ...ratings, [number]: rating });
    try {
      await api.rateQuestion(code, token, number, rating);
    } catch {
      setRatings((r) => {
        const copy = { ...r };
        if (previous) copy[number] = previous;
        else delete copy[number];
        return copy;
      });
    }
  };

  return (
    <section className="ratings">
      <h2>{t.rateTitle}</h2>
      <p className="rate-hint">{t.rateHint}</p>
      <ol className="rating-list">
        {results.questions.slice(0, shown).map((q) => (
          <li key={q.number}>
            <p className="rating-q">{q.text}</p>
            <div className="rating-buttons">
              {QUESTION_RATINGS.map((r) => (
                <button
                  key={r}
                  className={ratings[q.number] === r ? "on" : ""}
                  aria-pressed={ratings[q.number] === r}
                  aria-label={t.rating[r].label}
                  onClick={() => rate(q.number, r)}
                >
                  {t.rating[r].icon}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {hidden > 0 && (
        <button className="link" onClick={() => setShown(shown + RATINGS_PAGE)}>
          {t.rateShowMore(Math.min(hidden, RATINGS_PAGE))}
        </button>
      )}
    </section>
  );
}
