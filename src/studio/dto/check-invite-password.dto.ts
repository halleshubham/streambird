import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckInvitePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
