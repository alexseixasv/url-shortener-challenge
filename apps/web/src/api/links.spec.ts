import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableLink } from './links.js';

describe('disableLink', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('PATCH body is { active: false } and accepts 204', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      text: vi.fn(),
      json: vi.fn(),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(disableLink('abc')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/links/abc',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      }),
    );
  });
});
