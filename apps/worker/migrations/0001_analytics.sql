-- Anonymous analytics (06-data-model §5, 09-system-design §5, §13).
-- No player ids, nicknames or room codes are ever stored here.

CREATE TABLE question_stats (
  question_id      TEXT PRIMARY KEY,
  times_played     INTEGER NOT NULL DEFAULT 0,
  times_skipped    INTEGER NOT NULL DEFAULT 0,
  answers          INTEGER NOT NULL DEFAULT 0,
  correct          INTEGER NOT NULL DEFAULT 0,
  response_ms_sum  INTEGER NOT NULL DEFAULT 0,
  hero_targeted    INTEGER NOT NULL DEFAULT 0,
  hero_success     INTEGER NOT NULL DEFAULT 0,
  great            INTEGER NOT NULL DEFAULT 0,
  fine             INTEGER NOT NULL DEFAULT 0,
  bad              INTEGER NOT NULL DEFAULT 0,
  last_played_at   INTEGER
);

-- Keys as in the content file, so a distractor nobody picks is visible (06 §5 ANSWER_OPTION_STATS).
CREATE TABLE answer_option_stats (
  question_id  TEXT NOT NULL,
  option_key   TEXT NOT NULL,
  selected     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, option_key)
);

CREATE TABLE game_sessions (
  game_uid         TEXT PRIMARY KEY,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER NOT NULL,
  players          INTEGER NOT NULL,
  questions_played INTEGER NOT NULL,
  ended_by         TEXT NOT NULL,
  soft_end_shown   INTEGER NOT NULL
);

CREATE TABLE session_feedback (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_uid         TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  play_again       TEXT NOT NULL,
  different_group  TEXT,
  difficulty       TEXT,
  pace             TEXT,
  cultural_balance TEXT
);

CREATE INDEX session_feedback_game ON session_feedback (game_uid);
