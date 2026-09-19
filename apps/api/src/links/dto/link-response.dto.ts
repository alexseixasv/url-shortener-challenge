export class LinkResponseDto {
  id!: string;
  slug!: string;
  shortUrl!: string;
  url!: string;
  expiresAt!: string | null;
  maxClicks!: number | null;
  createdAt!: string;
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
  const base = input.shortUrlBase.replace(/\/+$/, '');
  return {
    id: input.id,
    slug: input.slug,
    shortUrl: `${base}/${input.slug}`,
    url: input.destinationUrl,
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    maxClicks:
      input.maxClicks === null || input.maxClicks === undefined
        ? null
        : Number(input.maxClicks),
    createdAt: input.createdAt.toISOString(),
  };
}
