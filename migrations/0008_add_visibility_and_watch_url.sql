-- Supports: configurable broadcast visibility (YouTube's privacyStatus --
-- previously hardcoded to 'unlisted' in YouTubeProvider with no way to
-- change it), and surfacing each destination's actual public watch URL
-- back to the user (see YouTubeProvider.createBroadcast).
ALTER TABLE live_streams ADD COLUMN visibility TEXT;
ALTER TABLE live_stream_destinations ADD COLUMN watch_url TEXT;
