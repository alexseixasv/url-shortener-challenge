/**
 * Convert Prisma BigInt to JSON-safe number without silent precision loss.
 * Challenge scale (10M+) is below MAX_SAFE_INTEGER; overflow is still rejected.
 */
export function bigintToSafeNumber(value: bigint, field: string): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      `${field} exceeds Number.MAX_SAFE_INTEGER and cannot be serialized as number`,
    );
  }
  return Number(value);
}
