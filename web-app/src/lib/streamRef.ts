const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A stream id from what the founder pastes: a bare uuid or any URL/path containing one (https://streambird.app/streams/<uuid>, .../studio). */
export function parseStreamRef(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const m = UUID.exec(text);
  return m ? m[0].toLowerCase() : null;
}
