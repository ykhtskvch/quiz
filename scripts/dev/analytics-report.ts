// KPI report from the anonymous analytics database (EPIC 30; 09-system-design §13).
//   node scripts/dev/analytics-report.ts           # local D1 used by `wrangler dev`
//   node scripts/dev/analytics-report.ts --remote  # production D1
//   node scripts/dev/analytics-report.ts --staging # staging D1 (playtests)
import { execFileSync } from "node:child_process";

const staging = process.argv.includes("--staging");
const remote = staging || process.argv.includes("--remote");
const target = staging ? ["quiz-analytics-staging", "--env", "staging"] : ["quiz-analytics"];

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
