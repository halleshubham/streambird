import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { docsUrl } from '../docs';

/** Opens the documentation (optionally a specific page) in a new tab. */
export function DocsLink({ page, children, className }: { page?: string; children?: ReactNode; className?: string }) {
  return (
    <a href={docsUrl(page)} target="_blank" rel="noopener noreferrer" className={className}>
      {children ?? 'Docs'} <ExternalLink size={12} aria-hidden />
    </a>
  );
}
