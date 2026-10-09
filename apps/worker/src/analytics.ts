// Writes anonymous analytics events to D1. Called off the gameplay path (ctx.waitUntil):
// a slow or failing write must never delay a question (07-api §16).
import { OPTION_KEYS, type AnalyticsEvent } from "@quiz/shared";

export function analyticsStatements(db: D1Database, e: AnalyticsEvent): D1PreparedStatement[] {
  switch (e.kind) {
    case "QUESTION_PLAYED":
      return [
        db
          .prepare(
            `INSERT INTO question_stats (question_id, times_played, answers, correct, response_ms_sum, hero_targeted, hero_success, last_played_at)
             VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (question_id) DO UPDATE SET
               times_played = times_played + 1,
               answers = answers + ?2,
               correct = correct + ?3,
               response_ms_sum = response_ms_sum + ?4,
               hero_targeted = hero_targeted + ?5,
               hero_success = hero_success + ?6,
               last_played_at = ?7`,
          )
          .bind(e.questionId, e.answered, e.correct, e.responseMsSum, e.heroTargeted ? 1 : 0, e.heroSuccess ? 1 : 0, e.at),
        ...OPTION_KEYS.filter((k) => e.distribution[k] > 0).map((k) =>
          db
            .prepare(
              `INSERT INTO answer_option_stats (question_id, option_key, selected) VALUES (?1, ?2, ?3)
               ON CONFLICT (question_id, option_key) DO UPDATE SET selected = selected + ?3`,
            )
            .bind(e.questionId, k, e.distribution[k]),
        ),
      ];
    case "QUESTION_SKIPPED":
      return [
        db
          .prepare(
            `INSERT INTO question_stats (question_id, times_skipped, last_played_at) VALUES (?1, 1, ?2)
             ON CONFLICT (question_id) DO UPDATE SET times_skipped = times_skipped + 1, last_played_at = ?2`,
          )
          .bind(e.questionId, e.at),
      ];
    case "GAME_FINISHED":
      return [
        db
          .prepare(
            `INSERT OR REPLACE INTO game_sessions (game_uid, started_at, ended_at, players, questions_played, ended_by, soft_end_shown)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .bind(e.gameUid, e.startedAt, e.endedAt, e.players, e.questionsPlayed, e.endedBy, e.softEndShown ? 1 : 0),
      ];
    case "SESSION_FEEDBACK": {
      const f = e.feedback;
      return [
        db
          .prepare(
            `INSERT INTO session_feedback (game_uid, created_at, play_again, different_group, difficulty, pace, cultural_balance)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          )
          .bind(e.gameUid, e.at, f.playAgain, f.differentGroup ?? null, f.difficulty ?? null, f.pace ?? null, f.culturalBalance ?? null),
      ];
    }
    case "QUESTION_RATED": {
      const columns = { GREAT: "great", FINE: "fine", BAD: "bad" } as const;
      const column = columns[e.rating];
      const add = db
        .prepare(
          `INSERT INTO question_stats (question_id, ${column}) VALUES (?1, 1)
           ON CONFLICT (question_id) DO UPDATE SET ${column} = ${column} + 1`,
        )
        .bind(e.questionId);
      if (!e.previous) return [add];
      const old = columns[e.previous];
      return [add, db.prepare(`UPDATE question_stats SET ${old} = MAX(${old} - 1, 0) WHERE question_id = ?1`).bind(e.questionId)];
    }
  }
}

export async function writeAnalytics(db: D1Database | undefined, events: AnalyticsEvent[]): Promise<void> {
  if (!db || events.length === 0) return;
  try {
    await db.batch(events.flatMap((e) => analyticsStatements(db, e)));
  } catch (err) {
    // Observability (NFR-013): log and move on — analytics loss is acceptable, a stuck game is not.
    console.error("analytics write failed", err);
  }
}
