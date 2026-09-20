import { apiRequest } from './client.js';
import type {
  CreateLinkInput,
  CreatedLink,
  LinkListResponse,
  LinkStats,
} from './types.js';

export function createLink(input: CreateLinkInput): Promise<CreatedLink> {
  return apiRequest<CreatedLink>('/links', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listLinks(signal?: AbortSignal): Promise<LinkListResponse> {
  return apiRequest<LinkListResponse>('/links', { signal });
}

export function getLinkStats(
  slug: string,
  signal?: AbortSignal,
): Promise<LinkStats> {
  return apiRequest<LinkStats>(`/links/${encodeURIComponent(slug)}/stats`, {
    signal,
  });
}

export function disableLink(slug: string): Promise<void> {
  return apiRequest<void>(`/links/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
    parseJson: false,
  });
}
