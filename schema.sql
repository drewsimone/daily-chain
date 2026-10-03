CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue      INTEGER NOT NULL,
  nick       TEXT    NOT NULL,
  nick_key   TEXT    NOT NULL,
  device     TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  points     INTEGER NOT NULL,
  names      INTEGER NOT NULL,
  flips      INTEGER NOT NULL,
  chain      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (issue, nick_key),
  UNIQUE (issue, device)
);
CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (issue, points DESC, names DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scores_ip ON scores (issue, ip_hash);
