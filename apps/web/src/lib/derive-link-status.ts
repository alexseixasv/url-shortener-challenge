export type LinkStatus = 'active' | 'inactive' | 'expired' | 'maxed';

export type LinkStatusInput = {
  active: boolean;
  expiresAt: string | null;
  maxClicks: number | null;
  clickCount: number;
};

/**
 * Presentation-only status. Precedence: inactive → expired → maxed → active.
 */
export function deriveLinkStatus(
  link: LinkStatusInput,
  now: Date = new Date(),
): LinkStatus {
  if (!link.active) {
    return 'inactive';
  }
  if (link.expiresAt != null) {
    const expiresMs = Date.parse(link.expiresAt);
    if (!Number.isNaN(expiresMs) && expiresMs <= now.getTime()) {
      return 'expired';
    }
  }
  if (
    link.maxClicks != null &&
    link.clickCount >= link.maxClicks
  ) {
    return 'maxed';
  }
  return 'active';
}

export function linkStatusLabel(status: LinkStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'inactive':
      return 'Inactive';
    case 'expired':
      return 'Expired';
    case 'maxed':
      return 'Maxed';
  }
}
