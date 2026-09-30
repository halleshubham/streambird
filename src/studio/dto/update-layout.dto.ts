import { IsObject } from 'class-validator';

export class UpdateLayoutDto {
  @IsObject()
  layoutConfig!: Record<string, unknown>;
}
