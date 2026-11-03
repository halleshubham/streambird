import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class GoogleAppRedeemDto {
  /** The one-time code from the streambird://auth?code=... link. */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  code!: string;

  /** The PKCE verifier (RFC 7636 charset, 43-128 chars) whose SHA-256 the app sent as `challenge`. */
  @IsString()
  @MinLength(43)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9\-._~]+$/)
  verifier!: string;
}
