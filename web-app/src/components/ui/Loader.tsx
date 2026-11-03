import { BirdLoader } from '../BirdLoader';
import { cx } from './helpers';

export { BirdLoader };

/** Small purple circle with a gap, for inline waits that are not a button (see Button `busy` for buttons). */
export function Spinner({ size = 'md', label = 'Loading' }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return <span role="status" aria-label={label} className={cx('ui-spinner', `ui-spinner--${size}`)} />;
}

/** A grey block that shimmers: build list/card placeholders from it. Decorative; wrap a group in <SkeletonGroup>. */
export function Skeleton({ width, height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cx('ui-skeleton', className)} style={{ width, height }} aria-hidden="true" />;
}

/** `<SkeletonGroup rows={3}/>`: a card-shaped loading placeholder (heading line + rows) announced once as "Loading". */
export function SkeletonGroup({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="ui-card ui-skeleton-group" aria-busy="true" aria-label={label} role="status">
      <Skeleton width={200} height={20} />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={48} width={i === rows - 1 && rows > 1 ? '70%' : undefined} />
      ))}
    </div>
  );
}

/** Full-page first load: the existing bird loader (stays mounted and plays its fly-out when `loading` flips false). */
export function PageLoader({ loading, label }: { loading: boolean; label?: string }) {
  return <BirdLoader loading={loading} compact label={label} />;
}
