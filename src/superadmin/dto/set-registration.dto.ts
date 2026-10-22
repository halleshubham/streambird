import { IsBoolean } from 'class-validator';

export class SetRegistrationDto {
  @IsBoolean()
  autoApprove!: boolean;
}
