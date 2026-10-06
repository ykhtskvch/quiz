// Font trial (DS-008): Manrope is a candidate, not a decision. `?font=manrope` turns it on for this
// device, `?font=default` turns it off; the choice is remembered so every screen of a game matches.
// The font is self-hosted (no requests to third parties) and only downloaded when switched on.
const KEY = "knowish.font";

function read(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get("font");
    if (fromUrl === "manrope" || fromUrl === "default") localStorage.setItem(KEY, fromUrl);
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

if (read() === "manrope") document.documentElement.dataset.font = "manrope";
