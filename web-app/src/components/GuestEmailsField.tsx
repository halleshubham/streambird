import { parseEmails } from '../lib/schedule';

/**
 * Free-text list of guest emails (commas, spaces or new lines) with a live
 * count of how many parsed as valid -- the parent re-parses on submit via
 * parseEmails, so this stays a plain controlled textarea.
 */
export function GuestEmailsField({
  value,
  onChange,
  id = 'guest-emails',
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  rows?: number;
}) {
  const { valid, invalid } = parseEmails(value);
  return (
    <>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="guest1@example.com, guest2@example.com"
        rows={rows}
      />
      <p className={`field-hint${invalid.length > 0 ? ' error' : ''}`}>
        {invalid.length > 0
          ? `Not a valid email: ${invalid.join(', ')}`
          : valid.length > 0
            ? `${valid.length} ${valid.length === 1 ? 'guest' : 'guests'} will get an email invite.`
            : 'Separate addresses with commas, spaces or new lines.'}
      </p>
    </>
  );
}
