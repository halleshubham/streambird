import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, registerDecorator, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AD_PLACEMENTS } from '../entities/brand-kit-ad.entity';
import type { AdMode, AdPlacement } from '../entities/brand-kit-ad.entity';

/**
 * One advertisement of a kit. Cross-field rules (interval needs showSec and everySec, one ad per placement, the
 * file is an owned asset of kind 'ad') are checked in BrandKitsService. Continuous ads store no schedule numbers.
 */
export class BrandKitAdDto {
  @IsIn(AD_PLACEMENTS as unknown as string[])
  placement!: AdPlacement;

  @IsUUID()
  assetId!: string;

  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsIn(['continuous', 'interval'])
  mode?: AdMode;

  @IsOptional() @IsInt() @Min(1) @Max(3600)
  showSec?: number;

  @IsOptional() @IsInt() @Min(1) @Max(86400)
  everySec?: number;
}


/** Same limits as a stream's own title and description (CreateStreamDto). */
export const MAX_KIT_TITLE = 200;
export const MAX_KIT_DESCRIPTION = 5000;

export const MAX_CLOCK_TIMEZONE = 64;

/** True when Node's Intl knows the IANA zone name. */
export function isKnownTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CLOCK_TIMEZONE) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Valid IANA time zone name (null is let through by ValidateIf in the callers). */
function IsTimeZoneName() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimeZoneName',
      target: object.constructor,
      propertyName,
      options: { message: 'The clock time zone must be a known time zone name such as Asia/Kolkata (up to 64 characters), or empty for the streamer\'s own device time zone.' },
      validator: { validate: (v: unknown) => isKnownTimeZone(v) },
    });
}

/** Trims a string; a blank one becomes null (= cleared). Anything that is not a string is left for the validators to refuse. */
const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CreateBrandKitDto {
  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetIdPortrait?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetIdPortrait?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  /** The kit's stream thumbnail (a JPG/PNG file of the library). null clears it, omitted leaves it unchanged. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  thumbnailAssetId?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Default stream title for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default title must be text.' }) @MaxLength(MAX_KIT_TITLE, { message: `The default title can be at most ${MAX_KIT_TITLE} characters.` })
  title?: string | null;

  /** Default stream description for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default description must be text.' }) @MaxLength(MAX_KIT_DESCRIPTION, { message: `The default description can be at most ${MAX_KIT_DESCRIPTION} characters.` })
  description?: string | null;

  /** Replace-all: the kit's ads become exactly this list (max 4, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[] | null;

  /** Same, for the portrait (9:16) set. `ads` is the landscape set. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  adsPortrait?: BrandKitAdDto[] | null;

  /** Shrink the live picture into the space an ad leaves free while it shows. */
  @IsOptional() @IsBoolean()
  adsShrinkPicture?: boolean;

  /** On-air date and time overlay, shared by the 16:9 and 9:16 sets. Omitted = unchanged. */
  @IsOptional() @IsBoolean({ message: 'The clock on/off setting must be true or false.' })
  clockEnabled?: boolean;

  @IsOptional() @IsIn(['top_left', 'top_right', 'bottom_left', 'bottom_right'], { message: 'The clock position must be top_left, top_right, bottom_left or bottom_right.' })
  clockPosition?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

  @IsOptional() @IsIn(['12h', '24h'], { message: 'The clock format must be 12h or 24h.' })
  clockFormat?: '12h' | '24h';

  @IsOptional() @IsBoolean({ message: 'The clock show-date setting must be true or false.' })
  clockShowDate?: boolean;

  @IsOptional() @IsBoolean({ message: 'The clock show-seconds setting must be true or false.' })
  clockShowSeconds?: boolean;

  /** IANA zone name, or null (or blank) = the streamer's device time zone. */
  @IsOptional() @Transform(trimOrNull) @ValidateIf((_, v) => v !== null) @IsTimeZoneName()
  clockTimezone?: string | null;

  @IsOptional() @IsIn(['small', 'medium', 'large'], { message: 'The clock size must be small, medium or large.' })
  clockSize?: 'small' | 'medium' | 'large';

  @IsOptional() @IsIn(['text', 'pill'], { message: 'The clock style must be text or pill.' })
  clockStyle?: 'text' | 'pill';

  @IsOptional() @IsBoolean({ message: 'The clock alternate setting must be true or false.' })
  clockAlternate?: boolean;
}

export class UpdateBrandKitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetIdPortrait?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetIdPortrait?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  /** The kit's stream thumbnail (a JPG/PNG file of the library). null clears it, omitted leaves it unchanged. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  thumbnailAssetId?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  /** Default stream title for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default title must be text.' }) @MaxLength(MAX_KIT_TITLE, { message: `The default title can be at most ${MAX_KIT_TITLE} characters.` })
  title?: string | null;

  /** Default stream description for streams using this kit. Trimmed; blank or null = none. */
  @IsOptional() @Transform(trimOrNull) @IsString({ message: 'The default description must be text.' }) @MaxLength(MAX_KIT_DESCRIPTION, { message: `The default description can be at most ${MAX_KIT_DESCRIPTION} characters.` })
  description?: string | null;

  /** Replace-all: the kit's ads become exactly this list (max 4, one per placement). Omitted = unchanged; [] = none. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  ads?: BrandKitAdDto[] | null;

  /** Same, for the portrait (9:16) set. `ads` is the landscape set. */
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BrandKitAdDto)
  adsPortrait?: BrandKitAdDto[] | null;

  /** Shrink the live picture into the space an ad leaves free while it shows. */
  @IsOptional() @IsBoolean()
  adsShrinkPicture?: boolean;

  /** On-air date and time overlay, shared by the 16:9 and 9:16 sets. Omitted = unchanged. */
  @IsOptional() @IsBoolean({ message: 'The clock on/off setting must be true or false.' })
  clockEnabled?: boolean;

  @IsOptional() @IsIn(['top_left', 'top_right', 'bottom_left', 'bottom_right'], { message: 'The clock position must be top_left, top_right, bottom_left or bottom_right.' })
  clockPosition?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

  @IsOptional() @IsIn(['12h', '24h'], { message: 'The clock format must be 12h or 24h.' })
  clockFormat?: '12h' | '24h';

  @IsOptional() @IsBoolean({ message: 'The clock show-date setting must be true or false.' })
  clockShowDate?: boolean;

  @IsOptional() @IsBoolean({ message: 'The clock show-seconds setting must be true or false.' })
  clockShowSeconds?: boolean;

  /** IANA zone name, or null (or blank) = the streamer's device time zone. */
  @IsOptional() @Transform(trimOrNull) @ValidateIf((_, v) => v !== null) @IsTimeZoneName()
  clockTimezone?: string | null;

  @IsOptional() @IsIn(['small', 'medium', 'large'], { message: 'The clock size must be small, medium or large.' })
  clockSize?: 'small' | 'medium' | 'large';

  @IsOptional() @IsIn(['text', 'pill'], { message: 'The clock style must be text or pill.' })
  clockStyle?: 'text' | 'pill';

  @IsOptional() @IsBoolean({ message: 'The clock alternate setting must be true or false.' })
  clockAlternate?: boolean;
}

export class AssignBrandKitDto {
  /** null = back to the account default. */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  brandKitId!: string | null;
}
