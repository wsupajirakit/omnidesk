import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { RegistrationInsightsQueryDto, TicketInsightsQueryDto } from './dto';
import { InsightRegistrationsService } from './insight-registrations';
import { InsightReportsService } from './insight-reports.service';

@ApiTags('insight-reports')
@Controller('api/insight-reports')
@RequirePermissions('insight.manage')
export class InsightReportsController {
  constructor(
    private readonly insightReportsService: InsightReportsService,
    private readonly insightRegistrationsService: InsightRegistrationsService,
  ) {}

  @Get('tickets')
  public async getTicketInsights(
    @Query() queryDto: TicketInsightsQueryDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.insightReportsService.getTicketInsights(queryDto, auth);
  }

  // [FEAT-20260820-REGINSIGHT] the "Register data" card — count-only, class
  // guard (insight.manage) applies exactly like the tickets endpoint above.
  @Get('registrations')
  public async getRegistrationInsights(
    @Query() queryDto: RegistrationInsightsQueryDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.insightRegistrationsService.getRegistrationCounts(
      queryDto,
      auth,
    );
  }
}
