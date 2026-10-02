import { useState } from "react";
import { isRoomCode } from "@quiz/shared";
import { api } from "../api.ts";
import { navigate } from "../router.ts";
import { t } from "../strings.ts";

export function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await api.createRoom();
      // The display token rides in the URL fragment: it never reaches the server logs,
      // and the display survives a reload.
      navigate(`/d/${room.roomCode}#t=${room.displayToken}`);
    } catch {
      setError(t.errorGeneric);
      setBusy(false);
    }
  };

  const normalized = code.trim().toUpperCase();

  return (
    <main className="home">
      <h1>{t.appName}</h1>
      <p className="muted">{t.tagline}</p>
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
