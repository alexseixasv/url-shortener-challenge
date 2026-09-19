import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { isReservedSlug } from '../slug.util.js';

@ValidatorConstraint({ name: 'isHttpOrHttpsUrl', async: false })
export class IsHttpOrHttpsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim() === '') {
      return false;
    }
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'url must be an absolute http or https URL';
  }
}

@ValidatorConstraint({ name: 'isFutureIsoDate', async: false })
export class IsFutureIsoDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) {
      return false;
    }
    return ms > Date.now();
  }

  defaultMessage(): string {
    return 'expiresAt must be a future ISO-8601 timestamp';
  }
}

@ValidatorConstraint({ name: 'isNotReservedSlug', async: false })
export class IsNotReservedSlugConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    return !isReservedSlug(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `slug "${String(args.value)}" is reserved`;
  }
}

export class CreateLinkDto {
  @IsString()
  @IsNotEmpty()
  @Validate(IsHttpOrHttpsUrlConstraint)
  url!: string;

  /** Omitted = auto slug. Explicit null is rejected (400). */
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[0-9A-Za-z]+$/, {
    message: 'slug must contain only Base62 characters (0-9, A-Z, a-z)',
  })
  @Validate(IsNotReservedSlugConstraint)
  slug?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601()
  @Validate(IsFutureIsoDateConstraint)
  expiresAt?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  maxClicks?: number;
}
