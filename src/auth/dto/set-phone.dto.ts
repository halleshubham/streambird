import { IsString, MaxLength } from 'class-validator';

export class SetPhoneDto {
  @IsString()
  @MaxLength(32)
  phone!: string;
}
