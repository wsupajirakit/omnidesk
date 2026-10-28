/**
 * ==== [FEAT-20260811-PAYRESPEXAMPLES] payment controller — display data only ====
 *
 * ONE route, and deliberately a mouthful: it serves the hook-modal "eye" guide
 * the real provider response examples per reply state, so the dashboard never
 * hardcodes response bodies again (that bloated the FE and drifts silently).
 *
 * ⚠️ Nothing here participates in the money flow. The BE never calls this; the
 * classifiers never read the examples file. Auth = the global JwtAuthGuard
 * (APP_GUARD in auth.module), same as every other admin route — no decorator
 * needed. เส้นนี้เสิร์ฟข้อมูลโชว์อย่างเดียว ไม่เกี่ยวกับการตัดสินเงินใด ๆ.
 *
 * revert: delete this file + the `controllers` line in payment.module.ts +
 * the FE fetch in HookPaymentFlexBlock (it then shows "no capture yet" rows).
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  PAYMENT_REPLY_STATE_RESPONSE_EXAMPLES,
  ReplyStateResponseExample,
} from './payment-reply-response-examples';

@ApiTags('payment')
@Controller('payment')
export class PaymentController {
  @Get('hook-modal-reply-state-response-examples')
  @ApiOperation({
    summary:
      'Real provider response examples per payment reply state — display data for the hook-modal card-binding guide (nothing in the BE consumes this)',
  })
  getHookModalReplyStateResponseExamples(): {
    examples: Record<string, ReplyStateResponseExample[]>;
  } {
    return { examples: PAYMENT_REPLY_STATE_RESPONSE_EXAMPLES };
  }
}
