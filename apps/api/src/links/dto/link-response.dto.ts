export class LinkResponseDto {
  id!: string;
  slug!: string;
  shortUrl!: string;
  url!: string;
  expiresAt!: string | null;
  maxClicks!: number | null;
  createdAt!: string;
}

/** Shared short URL construction for POST response and GET /links list. */
export function buildShortUrl(shortUrlBase: string, slug: string): string {
  const base = shortUrlBase.replace(/\/+$/, '');
  return `${base}/${slug}`;
}

export function toLinkResponse(input: {
  id: string;
  slug: string;
  destinationUrl: string;
  expiresAt: Date | null;
  maxClicks: bigint | null;
  createdAt: Date;
  shortUrlBase: string;
}): LinkResponseDto {
  return {
    id: input.id,
    slug: input.slug,
    shortUrl: buildShortUrl(input.shortUrlBase, input.slug),
    url: input.destinationUrl,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    maxClicks:
      input.maxClicks === null || input.maxClicks === undefined
        ? null
        : Number(input.maxClicks),
    createdAt: input.createdAt.toISOString(),
  };
}
