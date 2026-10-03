import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MAX_GUESTS_PER_REQUEST = 20;
export const MAX_GUESTS_PER_STREAM = 50;

const normalizeEmails = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v)) : value;

export class ScheduleStreamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsISO8601()
  scheduledAt!: string;

  /** IANA zone name the host scheduled in, e.g. "Asia/Kolkata" -- used to render the time in invites. */
  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(720)
  durationMinutes?: number;

  /** Message to the guests, included in every invite. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  guestNotes?: string;

  @IsOptional()
  @IsIn(['public', 'unlisted', 'private'])
  visibility?: 'public' | 'unlisted' | 'private';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  @Type(() => String)
  destinationConnectionIds!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GUESTS_PER_REQUEST)
  @Transform(normalizeEmails)
  @IsEmail({}, { each: true })
  guestEmails?: string[];

  /**
   * Create the broadcast on the platforms that can hold a scheduled one
   * (YouTube, Facebook) right now instead of when the stream starts, so it
   * shows up there and its watch link can go in the invites. Twitch is
   * always created at start.
   */
  @IsOptional()
  @IsBoolean()
  createOnPlatforms?: boolean;

  /** Optional join password applied to every guest link of this stream. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  invitePassword?: string;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  guestNotes?: string;

  @IsOptional()
  @IsIn(['public', 'unlisted', 'private'])
  visibility?: 'public' | 'unlisted' | 'private';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  @Type(() => String)
  destinationConnectionIds?: string[];

  /** Turn pre-creating on the platforms on (creates the missing broadcasts) or off (removes them from the platforms). */
  @IsOptional()
  @IsBoolean()
  createOnPlatforms?: boolean;

  /** Email invited guests about a change to the time/title/details (default true). */
  @IsOptional()
  @IsBoolean()
  notifyGuests?: boolean;
}

export class AddScheduleGuestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GUESTS_PER_REQUEST)
  @Transform(normalizeEmails)
  @IsEmail({}, { each: true })
  emails!: string[];
}
