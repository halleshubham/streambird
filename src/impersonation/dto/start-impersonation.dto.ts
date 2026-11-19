import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class StartImpersonationDto {
  /** Exactly one of accountId / userId. An account opens as its company admin (else its first user). */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsIn(['view', 'act'])
  mode!: 'view' | 'act';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  reason?: string;
}
