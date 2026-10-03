-- Optional thumbnail image for a scheduled stream, applied to the platform
-- broadcasts (YouTube thumbnails.set; Facebook scheduled-live image). One
-- row per stream; small (<= 2 MB, enforced in the API), so it lives in the
-- database rather than needing object storage.
CREATE TABLE stream_thumbnails (
  live_stream_id UUID PRIMARY KEY REFERENCES live_streams(id) ON DELETE CASCADE,
  content_type   TEXT NOT NULL,
  data           BYTEA NOT NULL,
  width          INTEGER NOT NULL,
  height         INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
