import type { LinkStats } from '../api/types.js';
import { barWidthPercent, maxClicksInWindow } from '../lib/bar-scale.js';
import { formatDateTime, formatDayLabel } from '../lib/format.js';

type Props = {
  slug: string;
  loading: boolean;
  error: string | null;
  stats: LinkStats | null;
  onClose: () => void;
};

export function LinkStatsPanel({
  slug,
  loading,
  error,
  stats,
  onClose,
}: Props) {
  const max =
    stats != null
      ? maxClicksInWindow(stats.last7Days.map((d) => d.clicks))
      : 0;

  return (
    <section
      className="card card--soft"
      aria-labelledby="stats-title"
      aria-busy={loading}
    >
      <div className="section-head">
        <div>
          <h2 id="stats-title">Statistics</h2>
          <p className="section-head__caption">{slug}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {loading ? (
        <p className="status-message" aria-live="polite">
          Loading statistics…
        </p>
      ) : null}

      {error ? (
        <p className="status-message status-message--error" role="alert">
          {error}
        </p>
      ) : null}

      {stats && !loading ? (
        <>
          <div className="metric">
            <p className="metric__value">
              {stats.totalClicks.toLocaleString()}
            </p>
            <p className="metric__label">Total clicks</p>
          </div>

          <h3 className="card__title">Last 7 days</h3>
          <ul className="stats-bars">
            {stats.last7Days.map((day) => (
              <li key={day.date} className="stats-bars__row">
                <span>{formatDayLabel(day.date)}</span>
                <div
                  className="stats-bars__track"
                  role="img"
                  aria-label={`${day.clicks} clicks on ${day.date}`}
                >
                  <div
                    className="stats-bars__fill"
                    style={{
                      width: `${barWidthPercent(day.clicks, max)}%`,
                    }}
                  />
                </div>
                <span className="stats-bars__value">{day.clicks}</span>
              </li>
            ))}
          </ul>

          <h3 className="card__title">Recent accesses</h3>
          {stats.recentAccesses.length === 0 ? (
            <div className="empty-state">
              <strong>No accesses recorded yet.</strong>
              Open the short URL to generate events.
            </div>
          ) : (
            <ul className="access-list">
              {stats.recentAccesses.map((access, index) => (
                <li
                  key={`${access.accessedAt}-${index}`}
                  className="access-list__item"
                >
                  <p className="access-list__time">
                    {formatDateTime(access.accessedAt)}
                  </p>
                  <p className="access-list__line">
                    Referrer:{' '}
                    {access.referer ?? 'Direct / No referrer'}
                  </p>
                  <p className="access-list__line">
                    User agent: {access.userAgent ?? 'Unknown'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
