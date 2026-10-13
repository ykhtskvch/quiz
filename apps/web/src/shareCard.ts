// "Results of the evening" picture (EPIC 41 P-12): drawn on the device with a canvas, shared through
// the phone's share sheet or saved. Nothing goes to a server; only the players who share it decide
// where it goes.
import type { GameResults } from "@quiz/shared";
import { placeOf } from "./components.tsx";
import type { useT } from "./strings.ts";

type T = ReturnType<typeof useT>;

const W = 1080;
const H = 1350;
const PAD = 84;
const C = {
  bg: "#16131f",
  surface: "#221d30",
  text: "#f4f1fa",
  muted: "#a49cb8",
  accent: "#ffcc4d",
};
const MAX_ROWS = 6;

function font(px: number, weight = 600) {
  const family = getComputedStyle(document.documentElement).fontFamily || "system-ui, sans-serif";
  return `${weight} ${px}px ${family}`;
}

/** Splits text into at most `maxLines` lines that fit `width`; the last one ends with "…" if cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}

/** Two facts that make the evening retellable: the hardest question, then who-knew / divided. */
function facts(results: GameResults, t: T): { title: string; text: string; answer: string }[] {
  const s = results.stats;
  const out = [
    s.hardest && { title: t.statHardest, q: s.hardest },
    s.onlyOneKnew && { title: t.statOnlyOne, q: s.onlyOneKnew },
    s.mostDivided && { title: t.statDivided, q: s.mostDivided },
    s.everyoneKnew && { title: t.statEveryone, q: s.everyoneKnew },
  ].filter((x): x is { title: string; q: NonNullable<typeof s.hardest> } => Boolean(x));
  return out.slice(0, 2).map((f) => ({ title: f.title, text: f.q.text, answer: f.q.correctText }));
}

export async function renderResultsCard(results: GameResults, t: T, lang: string): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  const inner = W - 2 * PAD;
  let y = PAD + 60;

  // Brand and title.
  ctx.fillStyle = C.accent;
  ctx.font = font(64, 800);
  ctx.fillText(t.appName, PAD, y);
  ctx.fillStyle = C.muted;
  ctx.font = font(34, 500);
  const date = new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const title = `${t.cardTitle} · ${date}`;
  ctx.fillText(ellipsize(ctx, title, inner), PAD, (y += 58));

  // Winner(s).
  const board = results.leaderboard;
  const winners = board.filter((_, i) => placeOf(board, i) === 1);
  if (winners.length) {
    ctx.fillStyle = C.muted;
    ctx.font = font(34, 600);
    ctx.fillText(winners.length > 1 ? t.winners : t.winner, PAD, (y += 84));
    ctx.fillStyle = C.accent;
    ctx.font = font(96, 800);
    const names = wrap(ctx, winners.map((w) => w.nickname).join(" · "), inner, 2);
    for (const line of names) ctx.fillText(line, PAD, (y += 100));
    ctx.fillStyle = C.text;
    ctx.font = font(40, 600);
    ctx.fillText(t.score(winners[0].score), PAD, (y += 56));
  }

  // The rest of the table.
  const rest = board.map((l, i) => ({ l, place: placeOf(board, i) })).filter((r) => r.place > 1);
  if (rest.length) {
    y += 24;
    ctx.font = font(38, 600);
    for (const { l, place } of rest.slice(0, MAX_ROWS)) {
      y += 54;
      ctx.fillStyle = C.muted;
      ctx.fillText(`${place}.`, PAD, y);
      ctx.fillStyle = C.text;
      const score = t.score(l.score);
      const scoreW = ctx.measureText(score).width;
      ctx.fillText(ellipsize(ctx, l.nickname, inner - 90 - scoreW - 24), PAD + 90, y);
      ctx.fillText(score, W - PAD - scoreW, y);
    }
    if (rest.length > MAX_ROWS) {
      ctx.fillStyle = C.muted;
      ctx.font = font(32, 500);
      ctx.fillText(t.cardMore(rest.length - MAX_ROWS), PAD + 90, (y += 52));
    }
  }

  // Facts of the evening, in boxes, as long as they fit above the footer.
  const footerTop = H - PAD - 40;
  y += 44;
  for (const f of facts(results, t)) {
    ctx.font = font(36, 600);
    const lines = wrap(ctx, f.text, inner - 64, 2);
    ctx.font = font(30, 500);
    const answer = ellipsize(ctx, `${t.correctAnswer}: ${f.answer}`, inner - 64);
    const boxH = 28 + 26 + lines.length * 44 + 52 + 26;
    if (y + boxH > footerTop - 24) break;
    ctx.fillStyle = C.surface;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(PAD, y, inner, boxH, 28);
    else ctx.rect(PAD, y, inner, boxH); // older Safari
    ctx.fill();
    let by = y + 28 + 26;
    ctx.fillStyle = C.accent;
    ctx.font = font(26, 700);
    ctx.fillText(f.title.toUpperCase(), PAD + 32, by);
    ctx.fillStyle = C.text;
    ctx.font = font(36, 600);
    for (const line of lines) ctx.fillText(line, PAD + 32, (by += 44));
    ctx.fillStyle = C.muted;
    ctx.font = font(30, 500);
    ctx.fillText(answer, PAD + 32, (by += 52));
    y += boxH + 20;
  }

  // Footer: what it is and where to play.
  ctx.fillStyle = C.muted;
  ctx.font = font(32, 500);
  ctx.fillText(t.slogan, PAD, H - PAD);
  ctx.fillStyle = C.accent;
  ctx.font = font(36, 700);
  const site = "knowish.party";
  ctx.fillText(site, W - PAD - ctx.measureText(site).width, H - PAD);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"));
}

/** Share sheet with the picture where the phone supports it; otherwise save the file. */
export async function shareResultsCard(blob: Blob, t: T): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], "knowish.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t.appName, text: `${t.cardShareText} knowish.party` });
      return "shared";
    } catch {
      return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "knowish.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}
