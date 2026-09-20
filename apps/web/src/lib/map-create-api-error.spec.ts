import { describe, expect, it } from 'vitest';
import { mapCreateApiError } from './map-create-api-error.js';

describe('mapCreateApiError', () => {
  it('maps url validation to url field', () => {
    expect(
      mapCreateApiError('url must be an absolute http or https URL'),
    ).toEqual({
      field: 'url',
      message: 'url must be an absolute http or https URL',
    });
  });

  it('maps Base62 slug rule to friendly slug field error', () => {
    expect(
      mapCreateApiError(
        'slug must contain only Base62 characters (0-9, A-Z, a-z)',
      ),
    ).toEqual({ field: 'slug', message: 'Letters and numbers only' });
  });

  it('maps slug conflict / reserved to slug', () => {
    expect(mapCreateApiError('slug already exists')).toEqual({
      field: 'slug',
      message: 'slug already exists',
    });
    expect(mapCreateApiError('slug "links" is reserved')).toEqual({
      field: 'slug',
      message: 'slug "links" is reserved',
    });
  });

  it('maps expiresAt and maxClicks', () => {
    expect(
      mapCreateApiError('expiresAt must be a future ISO-8601 timestamp'),
    ).toEqual({
      field: 'expiresAt',
      message: 'expiresAt must be a future ISO-8601 timestamp',
    });
    expect(mapCreateApiError('maxClicks must not be less than 1')).toEqual({
      field: 'maxClicks',
      message: 'maxClicks must not be less than 1',
    });
  });

  it('keeps multi-field joined messages as form-level', () => {
    expect(
      mapCreateApiError(
        'url must be an absolute http or https URL; slug already exists',
      ),
    ).toEqual({
      field: null,
      message:
        'url must be an absolute http or https URL; slug already exists',
    });
  });
});
