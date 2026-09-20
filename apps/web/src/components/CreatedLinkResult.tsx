import { useState } from 'react';
import type { CreatedLink } from '../api/types.js';

type Props = {
  link: CreatedLink;
};

export function CreatedLinkResult({ link }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function handleCopy() {
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(link.shortUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Could not copy. Select the URL and copy manually.');
      setCopied(false);
    }
  }

  return (
    <section
      className="card card--soft"
      aria-labelledby="created-result-title"
      aria-live="polite"
    >
      <h2 className="card__title" id="created-result-title">
        Your short link
      </h2>
      <div className="created-result">
        <p className="created-result__url">{link.shortUrl}</p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError ? (
        <p className="status-message status-message--error" role="alert">
          {copyError}
        </p>
      ) : null}
    </section>
  );
}
