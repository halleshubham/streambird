import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GoogleMobileLoginDto {
  /** The Google ID token (a JWT) the Android app got from Credential Manager. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(8192)
  idToken!: string;
}
