import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { ModelService, type ModelErrorResponse } from './model.service';

/**
 * Root-mounted `/model`, matching legacy. Authenticated (global guard) but
 * carrying no `authorize(...)`, exactly as the legacy route did.
 */
@ApiTags('system')
@Controller('model')
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  /**
   * Writes the response itself instead of returning a value.
   *
   * The failure body here is `{success, message, error}` — legacy's own shape —
   * whereas every thrown exception is flattened by the global filter into
   * `{error}`. Throwing would therefore silently change the failure contract
   * this endpoint has with the dashboard, so the error path is written
   * directly and never reaches the filter.
   */
  @Get()
  @ApiOperation({ summary: 'List available Gemini models' })
  async getModels(@Res() res: Response): Promise<void> {
    try {
      const payload = await this.modelService.getModels();
      res.status(HttpStatus.OK).json(payload);
    } catch (err) {
      const body: ModelErrorResponse = {
        success: false,
        message: 'Cannot fetch models',
        error: (err as Error).message,
      };
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
    }
  }
}
