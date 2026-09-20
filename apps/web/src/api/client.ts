import { ApiError } from './types.js';

function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      'VITE_API_BASE_URL is not configured. Set it to the host-reachable API URL (e.g. http://localhost:3000).',
    );
  }
  return raw.replace(/\/+$/, '');
}

function nestMessage(body: unknown): string | null {
  if (body == null || typeof body !== 'object') {
    return null;
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim() !== '') {
    return message;
  }
  if (Array.isArray(message)) {
    const parts = message.filter(
      (part): part is string => typeof part === 'string' && part.trim() !== '',
    );
    if (parts.length > 0) {
      return parts.join('; ');
    }
  }
  return null;
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit & { parseJson?: boolean },
): Promise<T> {
  const { parseJson = true, ...fetchInit } = init ?? {};
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...fetchInit,
    headers: {
      Accept: 'application/json',
      ...(fetchInit.body ? { 'Content-Type': 'application/json' } : {}),
      ...fetchInit.headers,
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let body: unknown = null;
  if (text.trim() !== '') {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const fromNest = nestMessage(body);
    throw new ApiError(
      response.status,
      fromNest ?? `Request failed (${response.status})`,
    );
  }

  if (!parseJson) {
    return undefined as T;
  }

  if (body == null) {
    throw new ApiError(response.status, 'Empty response from API');
  }

  return body as T;
}

export function getApiBaseUrlForTests(): string {
  return apiBaseUrl();
}
