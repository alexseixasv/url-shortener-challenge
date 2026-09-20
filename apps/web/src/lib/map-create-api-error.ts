export type CreateFormField = 'url' | 'slug' | 'expiresAt' | 'maxClicks';

export type MappedCreateError = {
  field: CreateFormField | null;
  message: string;
};

/**
 * Best-effort mapping of Nest create errors to a single form field.
 * Ambiguous / multi-field messages stay as form-level (field: null).
 */
export function mapCreateApiError(raw: string): MappedCreateError {
  const message = raw.trim();
  if (message === '') {
    return { field: null, message: 'Unable to create link' };
  }

  // Joined validation arrays — only map when every part targets the same field
  if (message.includes(';')) {
    const parts = message.split(';').map((p) => p.trim()).filter(Boolean);
    const mapped = parts.map((part) => mapSingleCreateMessage(part));
    const fields = new Set(mapped.map((m) => m.field));
    if (fields.size === 1) {
      const only = mapped[0];
      return only.field == null
        ? { field: null, message }
        : { field: only.field, message: mapped.map((m) => m.message).join('; ') };
    }
    return { field: null, message };
  }

  return mapSingleCreateMessage(message);
}

function mapSingleCreateMessage(message: string): MappedCreateError {
  const lower = message.toLowerCase();

  if (
    lower.includes('base62') ||
    /^slug\b/.test(lower) ||
    lower.includes('slug already exists') ||
    lower.includes('is reserved')
  ) {
    if (lower.includes('base62')) {
      return { field: 'slug', message: 'Letters and numbers only' };
    }
    return { field: 'slug', message };
  }

  if (/^url\b/.test(lower) || lower.includes('http or https')) {
    return { field: 'url', message };
  }

  if (lower.includes('expiresat') || lower.includes('expires at')) {
    return { field: 'expiresAt', message };
  }

  if (lower.includes('maxclicks') || lower.includes('max clicks')) {
    return { field: 'maxClicks', message };
  }

  return { field: null, message };
}
