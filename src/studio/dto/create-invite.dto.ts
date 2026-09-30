import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateInviteDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440) // 24 hours
  expiresInMinutes?: number;
}
