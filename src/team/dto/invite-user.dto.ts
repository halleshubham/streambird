import { IsEmail, MaxLength } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}
