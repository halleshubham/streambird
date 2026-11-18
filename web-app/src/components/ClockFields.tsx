import { useState } from 'react';
import { CLOCK_POSITIONS, CLOCK_SIZES, COMMON_TIMEZONES, allTimeZones, isValidTimeZone, type ClockSettings } from '../studio/clock';

/**
 * The "Date and time" settings, shared by the studio's Look tab (`variant="studio"`) and the brand kit editor
 * (`variant="kit"`): the two screens differ only in the CSS classes of their segmented buttons. Every control has a
 * test id (`clock-enabled`, `clock-position-top_left`, `clock-format-24h`, `clock-show-date`, `clock-show-seconds`,
 * `clock-size-large`, `clock-timezone`, `clock-timezone-search`).
 */
export function ClockFields({ value, onChange, idPrefix, variant }: { value: ClockSettings; onChange: (patch: Partial<ClockSettings>) => void; idPrefix: string; variant: 'studio' | 'kit' }) {
  const seg = variant === 'kit' ? 'ha-seg' : 'segmented';
  const labelClass = variant === 'kit' ? 'ui-field-label' : undefined;
  const checkClass = variant === 'kit' ? 'ha-check' : 'clock-check';
  const [search, setSearch] = useState('');
  const zones = allTimeZones();
  const searchBad = search.trim() !== '' && !isValidTimeZone(search.trim());
  const inCommon = value.timezone === null || COMMON_TIMEZONES.some((z) => z.id === value.timezone);

  function segmented<T extends string>(label: string, key: string, options: Array<{ id: T; label: string }>, current: T, pick: (id: T) => void) {
    return (
      <div>
        <span className={labelClass} id={`${idPrefix}-${key}`} style={{ display: 'block', marginBottom: 6 }}>
          {label}
        </span>
        <div className={seg} role="group" aria-labelledby={`${idPrefix}-${key}`}>
          {options.map((o) => (
            <button key={o.id} type="button" className={current === o.id && variant === 'studio' ? 'active' : ''} aria-pressed={current === o.id} data-testid={`clock-${key}-${o.id}`} onClick={() => pick(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="clock-fields" data-testid="clock-fields" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label className={checkClass}>
        <input type="checkbox" checked={value.enabled} data-testid="clock-enabled" aria-label="Show date and time on the picture" onChange={(e) => onChange({ enabled: e.target.checked })} /> Show date and time on the picture
      </label>
      {value.enabled && (
        <>
          {segmented('Position', 'position', CLOCK_POSITIONS, value.position, (position) => onChange({ position }))}
          {segmented('Time format', 'format', [{ id: '12h' as const, label: '12 hour' }, { id: '24h' as const, label: '24 hour' }], value.format, (format) => onChange({ format }))}
          <label className={checkClass}>
            <input type="checkbox" checked={value.showDate} data-testid="clock-show-date" onChange={(e) => onChange({ showDate: e.target.checked })} /> Show the date
          </label>
          <label className={checkClass}>
            <input type="checkbox" checked={value.showSeconds} data-testid="clock-show-seconds" onChange={(e) => onChange({ showSeconds: e.target.checked })} /> Show seconds
          </label>
          {segmented('Size', 'size', CLOCK_SIZES, value.size, (size) => onChange({ size }))}
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-tz`} style={{ display: 'block', marginBottom: 6 }}>
              Time zone
            </label>
            <select id={`${idPrefix}-tz`} data-testid="clock-timezone" value={value.timezone ?? ''} onChange={(e) => onChange({ timezone: e.target.value === '' ? null : e.target.value })}>
              <option value="">This device (auto)</option>
              {!inCommon && value.timezone && <option value={value.timezone}>{value.timezone}</option>}
              {COMMON_TIMEZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
            <input
              id={`${idPrefix}-tz-search`}
              type="text"
              list={`${idPrefix}-tz-list`}
              placeholder="Other time zone, e.g. Africa/Nairobi"
              aria-label="Search all time zones"
              aria-invalid={searchBad}
              data-testid="clock-timezone-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const v = e.target.value.trim();
                if (v && isValidTimeZone(v)) onChange({ timezone: v });
              }}
            />
            <datalist id={`${idPrefix}-tz-list`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            {searchBad && <p className="field-hint">That is not a time zone name. Pick one from the list, for example Asia/Kolkata.</p>}
          </div>
        </>
      )}
    </div>
  );
}
