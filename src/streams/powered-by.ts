/** The line added to a stream's description on the platforms for accounts whose plan shows the StreamBird mark. */
export const POWERED_BY_LINE = 'Powered by StreamBird - https://streambird.app';

/** `description` with the Powered-by line appended after a blank line (once; never duplicated). */
export function withPoweredBy(description: string | undefined | null): string {
  const base = (description ?? '').trim();
  if (base.includes('streambird.app')) return base;
  return base ? `${base}\n\n${POWERED_BY_LINE}` : POWERED_BY_LINE;
}
