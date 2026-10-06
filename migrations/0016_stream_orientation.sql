-- A stream is either landscape (16:9, the default and what every existing stream is) or
-- portrait (9:16, e.g. for YouTube vertical / Shorts live). It decides the size of the
-- studio canvas the host publishes and which "technical difficulties" slate is shown if
-- the host drops: one encode fans out to every destination, so it is a per-stream choice.
ALTER TABLE live_streams
  ADD COLUMN orientation TEXT NOT NULL DEFAULT 'landscape'
  CHECK (orientation IN ('landscape', 'portrait'));
