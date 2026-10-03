import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListStreamsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;

  /** 'upcoming' = scheduled streams that haven't started, soonest first. */
  @IsOptional()
  @IsIn(['upcoming'])
  view?: 'upcoming';
}
