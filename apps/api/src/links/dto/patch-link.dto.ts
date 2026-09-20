import { Equals, IsBoolean } from 'class-validator';

/**
 * PATCH /links/:slug accepts only disable in this unit.
 * active must be the boolean false (not true, not omitted).
 */
export class PatchLinkDto {
  @IsBoolean()
  @Equals(false, { message: 'active must be false (disable only)' })
  active!: false;
}
