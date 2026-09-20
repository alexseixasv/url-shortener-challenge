import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POST_LINKS_RATE_LIMIT_MAX,
  DEFAULT_POST_LINKS_RATE_LIMIT_WINDOW_SECONDS,
  getPostLinksRateLimitConfig,
  postLinksRateLimitKey,
} from './rate-limit.config.js';

describe('rate-limit.config', () => {
  const prevMax = process.env.RATE_LIMIT_POST_LINKS_MAX;
  const prevWindow = process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;

  afterEach(() => {
    if (prevMax === undefined) {
      delete process.env.RATE_LIMIT_POST_LINKS_MAX;
    } else {
      process.env.RATE_LIMIT_POST_LINKS_MAX = prevMax;
    }
    if (prevWindow === undefined) {
      delete process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;
    } else {
      process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = prevWindow;
    }
  });

  it('uses documented defaults when env unset or invalid', () => {
    delete process.env.RATE_LIMIT_POST_LINKS_MAX;
    delete process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS;
    expect(getPostLinksRateLimitConfig()).toEqual({
      max: DEFAULT_POST_LINKS_RATE_LIMIT_MAX,
      windowSeconds: DEFAULT_POST_LINKS_RATE_LIMIT_WINDOW_SECONDS,
    });

    process.env.RATE_LIMIT_POST_LINKS_MAX = '0';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = 'nope';
    expect(getPostLinksRateLimitConfig()).toEqual({
      max: DEFAULT_POST_LINKS_RATE_LIMIT_MAX,
      windowSeconds: DEFAULT_POST_LINKS_RATE_LIMIT_WINDOW_SECONDS,
    });
  });

  it('parses positive integers from env', () => {
    process.env.RATE_LIMIT_POST_LINKS_MAX = '5';
    process.env.RATE_LIMIT_POST_LINKS_WINDOW_SECONDS = '120';
    expect(getPostLinksRateLimitConfig()).toEqual({
      max: 5,
      windowSeconds: 120,
    });
  });

  it('builds namespaced keys; empty IP becomes unknown', () => {
    expect(postLinksRateLimitKey('127.0.0.1')).toBe('rl:post-links:127.0.0.1');
    expect(postLinksRateLimitKey('  ')).toBe('rl:post-links:unknown');
  });
});
