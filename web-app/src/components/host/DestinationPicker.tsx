import { Check, Plus } from 'lucide-react';
import type { PlatformConnection } from '../../types/api';
import { PlatformLogo } from '../PlatformLogo';
import { PLATFORM_LABELS } from '../PlatformBadge';

/**
 * Destinations as pill toggles. Each one is a real checkbox (named by the connection label, e.g. "Acme Channel"),
 * so keyboard, screen readers and `getByLabel(...).check()` all work; the pill is just its label.
 */
export function DestinationPicker({
  connections,
  selected,
  onToggle,
  disabled,
}: {
  connections: PlatformConnection[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ha-dest-row">
      {connections.map((c) => {
        const on = selected.has(c.id);
        return (
          <label key={c.id} className={`ha-dest${on ? ' is-on' : ''}`} title={PLATFORM_LABELS[c.platform]}>
            <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(c.id)} />
            {on ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            <PlatformLogo platform={c.platform} size={16} />
            <span>{c.label}</span>
          </label>
        );
      })}
    </div>
  );
}
