export type LinkListItemDto = {
  slug: string;
  shortUrl: string;
  url: string;
  active: boolean;
  expiresAt: string | null;
  maxClicks: number | null;
  clickCount: number;
  createdAt: string;
};

export type LinkListResponseDto = {
  items: LinkListItemDto[];
};
