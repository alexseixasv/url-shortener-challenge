import type { LinkListItem } from '../api/types.js';
import { LinkListItemRow } from './LinkListItem.js';

type Props = {
  items: LinkListItem[];
  loading: boolean;
  error: string | null;
  selectedSlug: string | null;
  disablingSlug: string | null;
  disableErrors: Record<string, string>;
  onViewStats: (slug: string) => void;
  onDisable: (slug: string) => void;
};

export function LinkList({
  items,
  loading,
  error,
  selectedSlug,
  disablingSlug,
  disableErrors,
  onViewStats,
  onDisable,
}: Props) {
  return (
    <section aria-labelledby="recent-links-title">
      <div className="section-head">
        <h2 id="recent-links-title">Recent links</h2>
        <p className="section-head__caption">50 most recent</p>
      </div>

      {loading ? (
        <p className="status-message" aria-live="polite">
          Loading links…
        </p>
      ) : null}

      {error ? (
        <p className="status-message status-message--error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="empty-state">
          <strong>No links yet.</strong>
          Create your first short link above.
        </div>
      ) : null}

      {!loading && items.length > 0 ? (
        <div className="card">
          <ul className="link-list">
            {items.map((link) => (
              <LinkListItemRow
                key={link.slug}
                link={link}
                selected={selectedSlug === link.slug}
                disabling={disablingSlug === link.slug}
                disableError={disableErrors[link.slug] ?? null}
                onViewStats={onViewStats}
                onDisable={onDisable}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
