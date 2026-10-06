import { useState } from "react";
import { isRoomCode, LANGUAGES } from "@quiz/shared";
import { api, ApiError } from "../api.ts";
import { BetaBadge } from "../components.tsx";
import { navigate } from "../router.ts";
import { setLanguage, useLanguage, useT } from "../strings.ts";

export function Home() {
  const t = useT();
  const lang = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom(lang);
      // The display token rides in the URL fragment: it never reaches the server logs,
      // and the display survives a reload.
      navigate(`/d/${room.roomCode}#t=${room.displayToken}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t.tooManyRequests : t.errorGeneric);
      setBusy(false);
    }
  };

  const normalized = code.trim().toUpperCase();

  return (
    <main className="home">
      <h1>{t.appName}</h1>
      <p className="muted">{t.tagline}</p>
      <BetaBadge />
      <div className="lang-pick" role="radiogroup" aria-label={t.gameLanguage}>
        <span className="muted small">{t.gameLanguage}</span>
        <div className="segmented">
          {LANGUAGES.map((l) => (
            <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => setLanguage(l, true)}>
              {t.languageName[l]}
            </button>
          ))}
        </div>
        <span className="muted small">{t.languageHint}</span>
      </div>
      <button className="primary big" onClick={create} disabled={busy}>
        {busy ? t.creating : t.createRoom}
      </button>
      {error && <p className="error">{error}</p>}

      <form
        className="join-code"
        onSubmit={(e) => {
          e.preventDefault();
          if (isRoomCode(normalized)) navigate(`/j/${normalized}`);
        }}
      >
        <label htmlFor="code">{t.haveCode}</label>
        <div className="row">
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC234"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button type="submit" disabled={!isRoomCode(normalized)}>
            {t.join}
          </button>
        </div>
      </form>
    </main>
  );
}
