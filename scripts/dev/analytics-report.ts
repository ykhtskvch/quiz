// KPI report from the anonymous analytics database (EPIC 30; 09-system-design §13).
//   node scripts/dev/analytics-report.ts           # local D1 used by `wrangler dev`
//   node scripts/dev/analytics-report.ts --production  # production D1 (--remote works too)
//   node scripts/dev/analytics-report.ts --staging     # staging D1 (playtests)
//   … --days=7                                        # funnel window (default 30 days)
import { execFileSync } from "node:child_process";

const staging = process.argv.includes("--staging");
const production = process.argv.includes("--production") || process.argv.includes("--remote");
const remote = staging || production;
const target = staging
  ? ["quiz-analytics-staging", "--env", "staging"]
  : production
    ? ["quiz-analytics", "--env", "production"]
    : ["quiz-analytics"];

function query<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", ...target, remote ? "--remote" : "--local", "--json", "--command", sql],
    { cwd: "apps/worker", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return (JSON.parse(out) as { results: T[] }[])[0]?.results ?? [];
}

const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const LABELS: Record<string, string> = {
  TOO_EASY: "Легко",
  JUST_RIGHT: "В самый раз",
  TOO_HARD: "Сложно",
  TOO_SLOW: "Медленно",
  TOO_FAST: "Быстро",
  MORE_CLASSIC: "Больше классики",
  MORE_POP: "Больше поп-культуры",
};

// ---------- sessions ----------
const [sessions] = query<{ games: number; players: number; questions: number; minutes: number; early: number }>(`
  SELECT COUNT(*) AS games,
         AVG(players) AS players,
         AVG(questions_played) AS questions,
         AVG((ended_at - started_at) / 60000.0) AS minutes,
         -- A game is a fixed number of questions; the host ending it before that is an early finish.
         AVG(CASE WHEN ended_by = 'HOST' THEN 1.0 ELSE 0 END) AS early
  FROM game_sessions`);

// ---------- core KPI: Play Again Intent ----------
const [intent] = query<{ n: number; yes: number; maybe: number; no: number; other_yes: number }>(`
  SELECT COUNT(*) AS n,
         AVG(play_again = 'YES') AS yes,
         AVG(play_again = 'MAYBE') AS maybe,
         AVG(play_again = 'NO') AS no,
         AVG(CASE WHEN different_group IS NULL THEN NULL ELSE different_group = 'YES' END) AS other_yes
  FROM session_feedback`);

const [players] = query<{ total: number }>(`SELECT SUM(players) AS total FROM game_sessions`);
const [accuracy] = query<{ accuracy: number; hero: number; heroTargeted: number }>(`
  SELECT SUM(correct) * 1.0 / NULLIF(SUM(answers), 0) AS accuracy,
         SUM(hero_success) * 1.0 / NULLIF(SUM(hero_targeted), 0) AS hero,
         SUM(hero_targeted) AS heroTargeted
  FROM question_stats`);

console.log("\n=== Сессии ===");
console.table({
  Игр: sessions?.games ?? 0,
  "Игроков в среднем": sessions?.players?.toFixed(1) ?? "—",
  "Вопросов за игру": sessions?.questions?.toFixed(1) ?? "—",
  "Длительность, мин": sessions?.minutes?.toFixed(1) ?? "—",
  "Досрочно закончили": pct(sessions?.early),
});

console.log("=== Главная метрика: хочется сыграть ещё (BR-115) ===");
console.table({
  Ответов: intent?.n ?? 0,
  "Заполнили анкету": pct(players?.total ? (intent?.n ?? 0) / players.total : null),
  Да: pct(intent?.yes),
  "Может быть": pct(intent?.maybe),
  Нет: pct(intent?.no),
  "С другой компанией — да": pct(intent?.other_yes),
});

console.log("=== Игра ===");
console.table({
  "Средняя точность (цель 50–70 %)": pct(accuracy?.accuracy),
  "Hero-вопросов": accuracy?.heroTargeted ?? 0,
  "Hero-удач (Engine §16)": pct(accuracy?.hero),
});

for (const [title, column] of [
  ["Сложность", "difficulty"],
  ["Темп", "pace"],
  ["Темы", "cultural_balance"],
] as const) {
  const rows = query<{ value: string; share: number }>(`
    SELECT ${column} AS value, COUNT(*) * 1.0 / SUM(COUNT(*)) OVER () AS share
    FROM session_feedback WHERE ${column} IS NOT NULL GROUP BY ${column} ORDER BY share DESC`);
  if (rows.length) {
    console.log(`=== ${title} ===`);
    console.table(Object.fromEntries(rows.map((r) => [LABELS[r.value] ?? r.value, pct(r.share)])));
  }
}

// ---------- question quality → review queue (US-FEED-003) ----------
const review = query<{ question_id: string; played: number; accuracy: number | null; skip: number; bad: number | null; reason: string }>(`
  SELECT question_id,
         times_played AS played,
         correct * 1.0 / NULLIF(answers, 0) AS accuracy,
         times_skipped * 1.0 / NULLIF(times_played + times_skipped, 0) AS skip,
         bad * 1.0 / NULLIF(great + fine + bad, 0) AS bad,
         TRIM(
           CASE WHEN bad * 1.0 / NULLIF(great + fine + bad, 0) >= 0.3 AND great + fine + bad >= 3 THEN 'много «плохо»; ' ELSE '' END ||
           CASE WHEN times_skipped * 1.0 / NULLIF(times_played + times_skipped, 0) >= 0.3 AND times_played + times_skipped >= 3 THEN 'часто пропускают; ' ELSE '' END ||
           CASE WHEN answers >= 5 AND correct * 1.0 / answers < 0.15 THEN 'почти никто не знает; ' ELSE '' END ||
           CASE WHEN answers >= 5 AND correct * 1.0 / answers > 0.95 THEN 'слишком лёгкий; ' ELSE '' END
         ) AS reason
  FROM question_stats
  WHERE reason <> ''
  ORDER BY bad DESC, skip DESC
  LIMIT 20`);
console.log("=== На доработку ===");
if (review.length) console.table(review.map((r) => ({ вопрос: r.question_id, сыгран: r.played, точность: pct(r.accuracy), skip: pct(r.skip), плохо: pct(r.bad), почему: r.reason })));
else console.log("Нет вопросов с плохими сигналами.\n");

const deadDistractors = query<{ question_id: string; chosen_options: number; answers: number }>(`
  SELECT s.question_id, COUNT(o.option_key) AS chosen_options, s.answers
  FROM question_stats s LEFT JOIN answer_option_stats o USING (question_id)
  WHERE s.answers >= 8
  GROUP BY s.question_id
  HAVING chosen_options < 4
  ORDER BY s.answers DESC
  LIMIT 20`);
console.log("=== Неработающие distractors (вариант ни разу не выбрали при ≥ 8 ответах) ===");
if (deadDistractors.length) console.table(deadDistractors);
else console.log("Пока нет.\n");

// ---------- funnel (EPIC 41 P-07) ----------
const days = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
const funnelRows = query<{ step: string; n: number }>(`
  SELECT step, SUM(n) AS n FROM funnel_daily
  WHERE day >= date('now', '-${Math.max(1, Math.floor(days))} days')
  GROUP BY step`);
const f = (step: string) => funnelRows.find((r) => r.step === step)?.n ?? 0;
const share = (a: number, b: number) => (b ? pct(a / b) : "—");
const rooms = f("room_created_tv") + f("room_created_phones");
console.log(`=== Воронка за ${days} дн. (P-07) ===`);
if (!funnelRows.length) console.log("Пока пусто: счётчики пишутся с 13.10.2026.\n");
else {
  console.table({
    "Заходы на главную": f("home_view"),
    "Переходы по приглашению": f("join_view"),
    "Комнат создано": `${rooms} (с ТВ ${f("room_created_tv")}, без ТВ ${f("room_created_phones")})`,
    "…из них тем же экраном повторно": f("room_created_returning"),
    "…игроком, который стал ведущим": f("room_created_by_player"),
    "Игроков вошло": f("player_joined"),
    "Игр начато": f("game_started"),
    "Доиграно": f("game_completed"),
    "Закончено досрочно": f("game_ended_early"),
    "«Сыграть ещё»": f("play_again"),
  });
  console.table({
    "Заход → комната": share(rooms, f("home_view")),
    "Комната → игра": share(f("game_started") - f("play_again"), rooms),
    "Игра → доиграна": share(f("game_completed"), f("game_started")),
    "Закончена → ещё раз": share(f("play_again"), f("game_completed") + f("game_ended_early")),
    "Повторные комнаты": share(f("room_created_returning"), rooms),
    "Игроки → ведущие": share(f("room_created_by_player"), rooms),
  });
}

// ---------- survey comments (EPIC 41 P-08) ----------
const comments = query<{ day: string; play_again: string; comment: string }>(`
  SELECT date(created_at / 1000, 'unixepoch') AS day, play_again, comment FROM session_feedback
  WHERE comment IS NOT NULL ORDER BY created_at DESC LIMIT 20`);
console.log("=== «Что улучшить?» — последние комментарии ===");
if (comments.length) console.table(comments.map((c) => ({ день: c.day, "ещё?": c.play_again, комментарий: c.comment })));
else console.log("Пока нет.\n");
