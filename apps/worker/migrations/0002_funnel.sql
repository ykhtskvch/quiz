-- Funnel (EPIC 41 P-07): how many visits turn into rooms, games, finished games and new hosts.
-- Daily counters only: no ids, devices, room codes or addresses.

CREATE TABLE funnel_daily (
  day   TEXT NOT NULL,      -- UTC date, YYYY-MM-DD
  step  TEXT NOT NULL,      -- FunnelStep in packages/shared/src/protocol.ts
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, step)
);
