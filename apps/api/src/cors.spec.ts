import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCorsFromEnv } from './cors.js';

describe('applyCorsFromEnv', () => {
  const prev = process.env.CORS_ORIGIN;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = prev;
    }
  });

  it('enables CORS with default localhost:5173 origin', () => {
    delete process.env.CORS_ORIGIN;
    const enableCors = vi.fn();
    applyCorsFromEnv({ enableCors } as never);
    expect(enableCors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'http://localhost:5173' }),
    );
  });

  it('uses CORS_ORIGIN when set', () => {
    process.env.CORS_ORIGIN = 'http://localhost:4173';
    const enableCors = vi.fn();
    applyCorsFromEnv({ enableCors } as never);
    expect(enableCors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'http://localhost:4173' }),
    );
  });
});
