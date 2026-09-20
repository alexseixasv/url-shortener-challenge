import type { CreateLinkInput } from '../api/types.js';

export type CreateLinkFormValues = {
  url: string;
  slug: string;
  expiresAtLocal: string;
  maxClicks: string;
};

/**
 * Build POST /links body. Empty optionals are omitted (not sent as "").
 * expiresAtLocal from datetime-local → ISO-8601 for the API.
 */
export function normalizeCreatePayload(
  values: CreateLinkFormValues,
): CreateLinkInput {
  const payload: CreateLinkInput = {
    url: values.url.trim(),
  };

  const slug = values.slug.trim();
  if (slug !== '') {
    payload.slug = slug;
  }

  const expiresLocal = values.expiresAtLocal.trim();
  if (expiresLocal !== '') {
    const ms = Date.parse(expiresLocal);
    if (!Number.isNaN(ms)) {
      payload.expiresAt = new Date(ms).toISOString();
    }
  }

  const maxRaw = values.maxClicks.trim();
  if (maxRaw !== '') {
    const n = Number(maxRaw);
    if (Number.isInteger(n) && n > 0) {
      payload.maxClicks = n;
    }
  }

  return payload;
}
