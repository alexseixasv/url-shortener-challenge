import { describe, expect, it } from 'vitest';
import { deriveLinkStatus } from './derive-link-status.js';

describe('deriveLinkStatus', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('returns inactive when active is false (precedence)', () => {
    expect(
      deriveLinkStatus(
        {
          active: false,
          expiresAt: '2020-01-01T00:00:00.000Z',
          maxClicks: 1,
          clickCount: 1,
        },
        now,
      ),
    ).toBe('inactive');
  });

  it('returns expired when past expiresAt', () => {
    expect(
      deriveLinkStatus(
        {
          active: true,
          expiresAt: '2020-01-01T00:00:00.000Z',
          maxClicks: null,
          clickCount: 0,
        },
        now,
      ),
    ).toBe('expired');
  });

  it('returns expired before maxed when both apply', () => {
    expect(
      deriveLinkStatus(
        {
          active: true,
          expiresAt: '2020-01-01T00:00:00.000Z',
          maxClicks: 1,
          clickCount: 5,
        },
        now,
      ),
    ).toBe('expired');
  });

  it('returns maxed when clickCount exceeds maxClicks', () => {
    expect(
      deriveLinkStatus(
        {
          active: true,
          expiresAt: null,
          maxClicks: 10,
          clickCount: 11,
        },
        now,
      ),
    ).toBe('maxed');
  });

  it('returns active otherwise', () => {
    expect(
      deriveLinkStatus(
        {
          active: true,
          expiresAt: '2099-01-01T00:00:00.000Z',
          maxClicks: 10,
          clickCount: 2,
        },
        now,
      ),
    ).toBe('active');
  });
});
