import { describe, expect, it, vi } from 'vitest';
import { applyTrustProxyFromEnv } from './trust-proxy.js';

describe('applyTrustProxyFromEnv', () => {
  it('does nothing when unset or false', () => {
    delete process.env.TRUST_PROXY;
    const set = vi.fn();
    applyTrustProxyFromEnv({ set } as never);
    expect(set).not.toHaveBeenCalled();

    process.env.TRUST_PROXY = 'false';
    applyTrustProxyFromEnv({ set } as never);
    expect(set).not.toHaveBeenCalled();
  });

  it('sets trust proxy hop count when configured', () => {
    const set = vi.fn();
    process.env.TRUST_PROXY = 'true';
    applyTrustProxyFromEnv({ set } as never);
    expect(set).toHaveBeenCalledWith('trust proxy', 1);

    set.mockClear();
    process.env.TRUST_PROXY = '2';
    applyTrustProxyFromEnv({ set } as never);
    expect(set).toHaveBeenCalledWith('trust proxy', 2);

    delete process.env.TRUST_PROXY;
  });
});
