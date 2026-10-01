import { IsEmail, IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class SignupCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
