import { IsString, Length } from 'class-validator';
import { SuperadminLoginDto } from './superadmin-login.dto';

export class SuperadminVerifyDto extends SuperadminLoginDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
