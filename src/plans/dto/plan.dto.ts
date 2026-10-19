import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min,
  ValidateIf,
} from 'class-validator';

/**
 * Nullable numeric fields use ValidateIf so an explicit `null` ("unlimited" /
 * "no cap" / "no price") passes while a wrong type is still rejected.
 */
export class CreatePlanDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,39}$/, { message: 'key must be lowercase letters, digits and underscores (2-40 chars)' })
  key!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsIn(['monthly', 'day_pass'])
  kind?: 'monthly' | 'day_pass';

  /** null = unlimited hours. */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0) @Max(100000)
  includedHoursPerMonth?: number | null;

  @IsOptional() @IsNumber() @Min(1) @Max(5)
  graceMultiplier?: number;

  @IsInt() @Min(1) @Max(50)
  maxDestinations!: number;

  @IsInt() @Min(0) @Max(50)
  maxGuests!: number;

  @IsOptional() @IsIn(['sd', 'hd', 'fhd', 'qhd'])
  maxResolution?: 'sd' | 'hd' | 'fhd' | 'qhd';

  @IsOptional() @IsBoolean()
  canRecord?: boolean;

  @IsOptional() @IsBoolean()
  canChromaKey?: boolean;

  @IsOptional() @IsBoolean()
  canLowerThird?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(102400)
  assetStorageMb?: number;

  @IsOptional() @IsBoolean()
  watermark?: boolean;

  /** null = no per-session cap. */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0.25) @Max(168)
  maxSessionHours?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(1) @Max(24 * 365)
  validityHours?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(0)
  priceInr?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0)
  priceUsd?: number | null;

  @IsOptional() @IsBoolean()
  isPublic?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  sortOrder?: number;
}

/** The key is immutable (accounts reference it). Every field optional; an explicit null clears the nullable ones. */
export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsIn(['monthly', 'day_pass'])
  kind?: 'monthly' | 'day_pass';

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0) @Max(100000)
  includedHoursPerMonth?: number | null;

  @IsOptional() @IsNumber() @Min(1) @Max(5)
  graceMultiplier?: number;

  @IsOptional() @IsInt() @Min(1) @Max(50)
  maxDestinations?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  maxGuests?: number;

  @IsOptional() @IsIn(['sd', 'hd', 'fhd', 'qhd'])
  maxResolution?: 'sd' | 'hd' | 'fhd' | 'qhd';

  @IsOptional() @IsBoolean()
  canRecord?: boolean;

  @IsOptional() @IsBoolean()
  canChromaKey?: boolean;

  @IsOptional() @IsBoolean()
  canLowerThird?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(102400)
  assetStorageMb?: number;

  @IsOptional() @IsBoolean()
  watermark?: boolean;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0.25) @Max(168)
  maxSessionHours?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(1) @Max(24 * 365)
  validityHours?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsInt() @Min(0)
  priceInr?: number | null;

  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber() @Min(0)
  priceUsd?: number | null;

  @IsOptional() @IsBoolean()
  isPublic?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  sortOrder?: number;
}
