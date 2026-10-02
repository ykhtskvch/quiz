import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isRoomCode } from "@quiz/shared";
import { Display } from "./pages/Display.tsx";
import { Home } from "./pages/Home.tsx";
import { Player } from "./pages/Player.tsx";
import { usePath } from "./router.ts";
import "./styles.css";

function App() {
  const path = usePath();
  const m = path.match(/^\/([dj])\/([A-Za-z0-9]{6})\/?$/);
  if (m && isRoomCode(m[2].toUpperCase())) {
    const code = m[2].toUpperCase();
    return m[1] === "d" ? <Display key={code} code={code} /> : <Player key={code} code={code} />;
  }
  return <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
