-- Scheduled streams: a stream can now be planned ahead of time (date/time,
-- timezone, expected duration, notes for guests) and stay SCHEDULED -- no
-- platform broadcasts created, no MediaMTX path, no usage billed -- until
-- the host actually starts it (StreamsService.start).
--
-- is_scheduled_event distinguishes a deliberately scheduled stream from the
-- legacy transient 'scheduled' rows every stream passes through while
-- StreamsService.create() is still provisioning it.
ALTER TABLE live_streams ADD COLUMN is_scheduled_event BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE live_streams ADD COLUMN timezone TEXT;
ALTER TABLE live_streams ADD COLUMN expected_duration_minutes INTEGER;
ALTER TABLE live_streams ADD COLUMN guest_notes TEXT;
ALTER TABLE live_streams ADD COLUMN cancelled_at TIMESTAMPTZ;
-- Host chose to create the platform broadcasts (YouTube, Facebook) at scheduling time rather than at start.
ALTER TABLE live_streams ADD COLUMN precreate_on_platforms BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX ix_live_streams_upcoming ON live_streams(account_id, scheduled_at) WHERE is_scheduled_event;

-- Email-addressed guest invites: one personal join link per invited address.
ALTER TABLE studio_guest_invites ADD COLUMN email TEXT;
ALTER TABLE studio_guest_invites ADD COLUMN emailed_at TIMESTAMPTZ;
