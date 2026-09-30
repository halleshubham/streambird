import { IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * Twitch's Helix API does not expose a user's own stream key
 * programmatically (it was removed from the old Kraken API and never
 * re-added) — the only correct way to get it is for the user to copy it
 * from their own Twitch dashboard (Creator Dashboard -> Settings ->
 * Stream). This DTO is therefore not a testing stopgap; it's the actual
 * connection method for Twitch until/unless that changes.
 */
export class CreateManualTwitchConnectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @IsUrl({ protocols: ['rtmp', 'rtmps'], require_tld: false })
  ingestServerUrl!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  streamKey!: string;
}
