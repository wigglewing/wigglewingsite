-- Contact-form messages from wigglewing.com/support/
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  name       TEXT,
  email      TEXT    NOT NULL,
  app        TEXT,
  message    TEXT,
  device     TEXT,
  country    TEXT,
  emailed    INTEGER NOT NULL DEFAULT 0,  -- 1 once the notification reached the inbox
  email_error TEXT
);
CREATE INDEX messages_created_at ON messages (created_at);
