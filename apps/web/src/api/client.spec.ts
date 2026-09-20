import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client.js';
import { ApiError } from './types.js';

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('parses JSON success bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(apiRequest<{ ok: boolean }>('/x')).resolves.toEqual({
      ok: true,
    });
  });

  it('treats 204 as success without calling json()', async () => {
    const json = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 204,
        ok: true,
        text: json,
        json,
      }),
    );
    await expect(
      apiRequest<void>('/x', { method: 'PATCH', parseJson: false }),
    ).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('parses Nest message string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ statusCode: 400, message: 'slug already exists' }),
          { status: 400 },
        ),
      ),
    );
    await expect(apiRequest('/x')).rejects.toMatchObject({
      message: 'slug already exists',
      statusCode: 400,
    } satisfies Partial<ApiError>);
  });

  it('joins Nest message array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            statusCode: 400,
            message: ['url must be an absolute http or https URL', 'bad'],
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(apiRequest('/x')).rejects.toMatchObject({
      message: 'url must be an absolute http or https URL; bad',
    });
  });

  it('uses generic message for 5xx without Nest body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('oops', { status: 502 })),
    );
    await expect(apiRequest('/x')).rejects.toMatchObject({
      message: 'Request failed (502)',
      statusCode: 502,
    });
  });
});
