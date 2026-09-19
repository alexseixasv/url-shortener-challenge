import { describe, expect, it } from 'vitest';
import {
  parseAccessEventFields,
  truncateHeader,
  accessEventToStreamFields,
} from './access-event.payload.js';
import { HEADER_MAX_LENGTH } from './analytics.constants.js';

describe('access-event payload', () => {
  it('truncates headers to max length and nulls empty', () => {
    expect(truncateHeader(null, HEADER_MAX_LENGTH)).toBeNull();
    expect(truncateHeader('  ', HEADER_MAX_LENGTH)).toBeNull();
    expect(truncateHeader('ok', HEADER_MAX_LENGTH)).toBe('ok');
    const long = 'x'.repeat(HEADER_MAX_LENGTH + 10);
    expect(truncateHeader(long, HEADER_MAX_LENGTH)?.length).toBe(
      HEADER_MAX_LENGTH,
    );
  });

  it('round-trips stream fields', () => {
    const event = {
      eventId: '11111111-1111-1111-1111-111111111111',
      linkId: '22222222-2222-2222-2222-222222222222',
      accessedAt: '2026-09-19T12:00:00.000Z',
      referer: null,
      userAgent: 'vitest',
      preCounted: false,
    };
    const fields = accessEventToStreamFields(event);
    expect(parseAccessEventFields(fields)).toEqual(event);
  });

  it('rejects invalid payloads', () => {
    expect(parseAccessEventFields(['eventId', 'x'])).toBeNull();
    expect(
      parseAccessEventFields([
        'eventId',
        '11111111-1111-1111-1111-111111111111',
        'linkId',
        '22222222-2222-2222-2222-222222222222',
        'accessedAt',
        '2026-09-19T12:00:00.000Z',
        'preCounted',
        'maybe',
      ]),
    ).toBeNull();
  });
});
