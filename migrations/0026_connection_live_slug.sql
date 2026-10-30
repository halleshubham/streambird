-- Permanent live link: every YouTube channel / Facebook Page connection gets one stable, unguessable public slug.
-- https://<site>/stream/<live_slug> redirects to the connection's running StreamBird live, else to the channel/page.
-- Nullable + UNIQUE (Postgres allows many NULLs): Twitch/LinkedIn connections have none, and the previous release
-- (which never reads this column) keeps working. Existing YouTube/Facebook rows are backfilled here, including
-- deactivated ones, so a reconnect keeps the same link. Re-running changes nothing (only NULL slugs are filled).
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS live_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_conn_live_slug ON platform_connections(live_slug);

DO $$
DECLARE
  r RECORD;
  s TEXT;
BEGIN
  FOR r IN SELECT id FROM platform_connections WHERE live_slug IS NULL AND platform IN ('youtube', 'facebook') LOOP
    LOOP
      s := substr(md5(random()::text || clock_timestamp()::text || r.id::text), 1, 10);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM platform_connections WHERE live_slug = s);
    END LOOP;
    UPDATE platform_connections SET live_slug = s WHERE id = r.id;
  END LOOP;
END $$;
