/** Gradient initial circle -- matches the name pill drawn on the broadcast canvas. */
export function NameBadge({ name, size = 22 }: { name: string; size?: number }) {
  const initial = (Array.from(name.trim())[0] ?? '?').toUpperCase();
  return (
    <span
      className="name-badge"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
