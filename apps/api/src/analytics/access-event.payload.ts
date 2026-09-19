export type AccessEventPayload = {
  eventId: string;
  linkId: string;
  accessedAt: string;
  referer: string | null;
  userAgent: string | null;
  preCounted: boolean;
};

export function truncateHeader(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function parseAccessEventFields(
  fields: string[],
): AccessEventPayload | null {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map.set(fields[i], fields[i + 1]);
  }

  const eventId = map.get('eventId');
  const linkId = map.get('linkId');
  const accessedAt = map.get('accessedAt');
  const preCountedRaw = map.get('preCounted');

  if (!eventId || !linkId || !accessedAt || preCountedRaw == null) {
    return null;
  }

  if (preCountedRaw !== 'true' && preCountedRaw !== 'false') {
    return null;
  }

  const refererRaw = map.get('referer');
  const userAgentRaw = map.get('userAgent');

  return {
    eventId,
    linkId,
    accessedAt,
    referer:
      refererRaw === undefined || refererRaw === '' ? null : refererRaw,
    userAgent:
      userAgentRaw === undefined || userAgentRaw === '' ? null : userAgentRaw,
    preCounted: preCountedRaw === 'true',
  };
}

export function accessEventToStreamFields(
  event: AccessEventPayload,
): string[] {
  return [
    'eventId',
    event.eventId,
    'linkId',
    event.linkId,
    'accessedAt',
    event.accessedAt,
    'referer',
    event.referer ?? '',
    'userAgent',
    event.userAgent ?? '',
    'preCounted',
    event.preCounted ? 'true' : 'false',
  ];
}
