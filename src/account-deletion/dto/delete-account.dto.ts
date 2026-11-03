import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class DeleteAccountDto {
  /** The 6-digit code emailed by POST /account/delete/request. */
  @IsString()
  @Length(6, 6)
  code!: string;

  /** Required (409 without it) when the caller is the only admin of a company that has other members. */
  @IsOptional()
  @IsBoolean()
  confirmCompanyDeletion?: boolean;
}
