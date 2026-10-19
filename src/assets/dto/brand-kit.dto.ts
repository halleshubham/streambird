import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateBrandKitDto {
  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class UpdateBrandKitDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  logoAssetId?: string | null;

  @IsOptional() @IsIn(['left', 'right'])
  logoPosition?: 'left' | 'right';

  @IsOptional() @IsInt() @Min(16) @Max(600)
  logoSize?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  wallpaperAssetId?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(80)
  wallpaperDim?: number;

  @IsOptional() @IsIn(['bar', 'accent', 'glass'])
  lowerThirdStyle?: 'bar' | 'accent' | 'glass';

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class AssignBrandKitDto {
  /** null = back to the account default. */
  @ValidateIf((_, v) => v !== null) @IsUUID()
  brandKitId!: string | null;
}
