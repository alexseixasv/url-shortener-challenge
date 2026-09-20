import {
  deriveLinkStatus,
  linkStatusLabel,
} from '../lib/derive-link-status.js';
import { formatDateTime } from '../lib/format.js';
import type { LinkListItem } from '../api/types.js';

type Props = {
  link: LinkListItem;
  selected: boolean;
  disabling: boolean;
  disableError: string | null;
  onViewStats: (slug: string) => void;
  onDisable: (slug: string) => void;
};

export function LinkListItemRow({
  link,
  selected,
  disabling,
  disableError,
  onViewStats,
  onDisable,
}: Props) {
  const status = deriveLinkStatus(link);
  const canDisable = link.active;

  return (
    <li className="link-list__item">
      <div className="link-list__top">
        <a
          className="link-list__short"
          href={link.shortUrl}
          target="_blank"
          rel="noreferrer"
        >
          {link.shortUrl}
        </a>
        <div className="link-list__meta">
          <span>
            <strong>{link.clickCount}</strong> clicks
          </span>
          <span className={`badge badge--${status}`}>
            {linkStatusLabel(status)}
          </span>
        </div>
      </div>
      <p className="link-list__destination">{link.url}</p>
      <div className="link-list__details">
        <span>Created {formatDateTime(link.createdAt)}</span>
        {link.expiresAt ? (
          <span>Expires {formatDateTime(link.expiresAt)}</span>
        ) : null}
        {link.maxClicks != null ? <span>Max {link.maxClicks}</span> : null}
      </div>
      <div className="link-list__actions">
        <button
          type="button"
          className="btn btn--text"
          aria-pressed={selected}
          onClick={() => onViewStats(link.slug)}
        >
          {selected ? 'Hide stats' : 'View stats'}
        </button>
        {canDisable ? (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={disabling}
            onClick={() => onDisable(link.slug)}
          >
            {disabling ? 'Disabling…' : 'Disable'}
          </button>
        ) : null}
      </div>
      {disableError ? (
        <p className="status-message status-message--error" role="alert">
          {disableError}
        </p>
      ) : null}
    </li>
  );
}
