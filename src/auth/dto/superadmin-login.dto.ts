import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SuperadminLoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
