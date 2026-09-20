export type LinkStatsDayDto = {
  date: string;
  clicks: number;
};

export type LinkStatsRecentAccessDto = {
  accessedAt: string;
  referer: string | null;
  userAgent: string | null;
};

export type LinkStatsResponseDto = {
  slug: string;
  totalClicks: number;
  last7Days: LinkStatsDayDto[];
  recentAccesses: LinkStatsRecentAccessDto[];
};
