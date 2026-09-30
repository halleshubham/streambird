import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class VerifyCodeDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
