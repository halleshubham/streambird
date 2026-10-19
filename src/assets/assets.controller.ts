import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AccountGuard } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';
import { AssetsService } from './assets.service';
import { BrandKitsService } from './brand-kits.service';
import { RenameAssetDto, UploadAssetDto } from './dto/asset.dto';
import { AssignBrandKitDto, CreateBrandKitDto, UpdateBrandKitDto } from './dto/brand-kit.dto';
import { MAX_ASSET_BYTES } from './image.util';

/** The account's asset library (files in R2) and brand kits (reusable looks). Paid plans; Free keeps assets in the browser. */
@Controller()
@UseGuards(AccountGuard)
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly kits: BrandKitsService,
  ) {}

  @Get('assets')
  list(@CurrentAccount() account: Account) {
    return this.assets.list(account.id);
  }

  /** Multipart (field "file", plus "kind" and optional "name"). multer's cap is a little above ours so the friendly message wins. */
  @Post('assets')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES + 1024 * 1024, files: 1 } }))
  upload(
    @CurrentAccount() account: Account,
    @Body() dto: UploadAssetDto,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
  ) {
    return this.assets.upload(account.id, file?.buffer, dto.kind, dto.name, file?.originalname);
  }

  /** The image itself, streamed through the backend (the bucket is private). Cached by the browser, revalidated by ETag. */
  @Get('assets/:id/file')
  async file(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { data, contentType, updatedAt } = await this.assets.read(account.id, id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Last-Modified', updatedAt.toUTCString());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }

  @Patch('assets/:id')
  async rename(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameAssetDto) {
    const a = await this.assets.rename(account.id, id, dto.name);
    return { id: a.id, name: a.name };
  }

  @Delete('assets/:id')
  @HttpCode(204)
  async remove(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.assets.remove(account.id, id);
  }

  @Get('brand-kits')
  listKits(@CurrentAccount() account: Account) {
    return this.kits.list(account.id);
  }

  @Post('brand-kits')
  createKit(@CurrentAccount() account: Account, @Body() dto: CreateBrandKitDto) {
    return this.kits.create(account.id, dto);
  }

  @Patch('brand-kits/:id')
  updateKit(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandKitDto) {
    return this.kits.update(account.id, id, dto);
  }

  @Delete('brand-kits/:id')
  @HttpCode(204)
  async removeKit(@CurrentAccount() account: Account, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.kits.remove(account.id, id);
  }

  /** Points a connection (YouTube channel / Facebook Page) at a kit; null sends it back to the account default. */
  @Put('brand-kits/connections/:connectionId')
  assign(@CurrentAccount() account: Account, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Body() dto: AssignBrandKitDto) {
    return this.kits.assign(account.id, connectionId, dto.brandKitId);
  }
}
