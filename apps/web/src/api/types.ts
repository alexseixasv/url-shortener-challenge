export type CreateLinkInput = {
  url: string;
  slug?: string;
  expiresAt?: string;
  maxClicks?: number;
};

export type CreatedLink = {
  id: string;
  slug: string;
  shortUrl: string;
  url: string;
  expiresAt: string | null;
  maxClicks: number | null;
  createdAt: string;
};

export type LinkListItem = {
  slug: string;
  shortUrl: string;
  url: string;
  active: boolean;
  expiresAt: string | null;
  maxClicks: number | null;
  clickCount: number;
  createdAt: string;
};

export type LinkListResponse = {
  items: LinkListItem[];
};

export type LinkStatsDay = {
  date: string;
  clicks: number;
};

export type LinkStatsRecentAccess = {
  accessedAt: string;
  referer: string | null;
  userAgent: string | null;
};

export type LinkStats = {
  slug: string;
  totalClicks: number;
  last7Days: LinkStatsDay[];
  recentAccesses: LinkStatsRecentAccess[];
};

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}
