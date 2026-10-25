import { useEffect, useState } from "react";
import { isRoomCode, LANGUAGES } from "@quiz/shared";
import { api, ApiError } from "../api.ts";
import { BetaBadge } from "../components.tsx";
import { playerHistory, trackOnce } from "../funnel.ts";
import { navigate } from "../router.ts";
import { seen } from "../seen.ts";
import { setLanguage, useLanguage, useT } from "../strings.ts";

export function Home() {
  const t = useT();
  const lang = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => trackOnce("home_view"), []);

  const create = async (phonesOnly: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom(lang, seen.list(), phonesOnly, playerHistory.hasPlayed());
      playerHistory.created(room.roomCode);
      // No TV (P-04): this phone joins first and so becomes the host. Otherwise this device is the
      // shared screen; its token rides in the URL fragment, never reaches server logs and survives a reload.
      navigate(phonesOnly ? `/j/${room.roomCode}` : `/d/${room.roomCode}#t=${room.displayToken}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t.tooManyRequests : t.errorGeneric);
      setBusy(false);
    }
  };

  const normalized = code.trim().toUpperCase();

  // "Enter another code" from a dead room link lands here with #join (DS-021).
  const focusJoin = location.hash === "#join";

  return (
    <main className="home">
      <header className="home-head">
        <h1>{t.appName}</h1>
        <p className="slogan">{t.slogan}</p>
        <p className="tagline">{t.tagline}</p>
        <a className="have-code" href="#join">
          {t.haveCodeJoin} ↓
        </a>
      </header>

      {/* P-09: what a stranger needs in ten seconds — what it costs, who for, how long, what you need. */}
      <div className="home-story">
        <ul className="home-facts">
          {t.homeFacts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>

        <Demo />

        <section className="home-steps" aria-labelledby="steps-title">
          <h2 id="steps-title">{t.stepsTitle}</h2>
          <ol>
            {t.steps.map((s) => (
              <li key={s.title}>
                <span className="step-icon" aria-hidden>
                  {s.icon}
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <span className="muted">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Two separate paths (DS-010): start a game on the big screen, or join one from a phone. */}
      <div className="home-actions">
        <section className="home-card" aria-labelledby="host-title">
          <h2 id="host-title">{t.hostTitle}</h2>
          <p className="how-to">{t.howTo}</p>
          <div className="lang-pick" role="radiogroup" aria-label={t.gameLanguage}>
            <span className="field-label">{t.gameLanguage}</span>
            <div className="segmented">
              {LANGUAGES.map((l) => (
                <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => setLanguage(l, true)}>
                  {t.languageName[l]}
                </button>
              ))}
            </div>
            <span className="muted hint">{t.languageHint}</span>
          </div>
          <button className="primary big" onClick={() => create(false)} disabled={busy}>
            {busy ? t.creating : t.createRoom}
          </button>
          <div className="phones-only">
            <button className="secondary big" onClick={() => create(true)} disabled={busy}>
              {t.createPhonesOnly}
            </button>
            <span className="muted hint">{t.phonesOnlyHint}</span>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="home-card" id="join" aria-labelledby="join-title">
          <h2 id="join-title">{t.joinTitle}</h2>
          <form
            className="join-code"
            onSubmit={(e) => {
              e.preventDefault();
              if (isRoomCode(normalized)) navigate(`/j/${normalized}`);
            }}
          >
            <label htmlFor="code" className="field-label">
              {t.roomCode}
            </label>
            <div className="row">
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABC234"
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus={focusJoin}
              />
              <button type="submit" disabled={!isRoomCode(normalized)}>
                {t.join}
              </button>
            </div>
          </form>
        </section>
      </div>

      <footer className="home-foot">
        <BetaBadge />
        <details className="privacy">
          <summary>{t.privacyTitle}</summary>
          <ul>
            {t.privacyItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <a href="/privacy" onClick={(e) => (e.preventDefault(), navigate("/privacy"))}>
            {t.privacyMore}
          </a>
        </details>
      </footer>
    </main>
  );
}

/**
 * A looping mini game instead of a video (P-09): the question appears on the "TV", someone taps an
 * answer on the "phone", the reveal, and the Hero Moment. Pure CSS; still frame for reduced motion.
 */
function Demo() {
  const t = useT();
  return (
    <figure className="demo" aria-label={t.demoLabel} role="img">
      <div className="demo-tv" aria-hidden>
        <p className="demo-q">{t.demoQuestion}</p>
        <ol className="demo-options">
          {t.demoOptions.map((o, i) => (
            <li key={o} className={i === 0 ? "right" : ""}>
              <span className="key">{"ABCD"[i]}</span>
              {o}
            </li>
          ))}
        </ol>
        <div className="demo-timer" />
        <p className="demo-hero">{t.demoHero}</p>
      </div>
      <div className="demo-phone" aria-hidden>
        {t.demoOptions.map((o, i) => (
          <span key={o} className={i === 0 ? "tap" : ""}>
            <span className="key">{"ABCD"[i]}</span>
          </span>
        ))}
        <span className="demo-points">+3</span>
      </div>
    </figure>
  );
}
