-- Cloudflare Stream Live Inputs expose a separate WebRTC(WHIP) publish URL
-- alongside the RTMPS ingest_url/stream_key already on live_streams. The
-- host's browser (client-side compositor) publishes here instead of RTMP.
ALTER TABLE live_streams ADD COLUMN whip_url TEXT;
