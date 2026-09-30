import { IsEmail, MaxLength } from 'class-validator';

export class RequestCodeDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
