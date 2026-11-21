import { Body, Controller, Get, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor.js';
import { CurrentSession, type SessionRequest } from '../common/security/session.guard.js';
import { AccountsPort } from '../core/recaudos.port.js';
import { PaymentsService } from './payments.service.js';

type Session = NonNullable<SessionRequest['session']>;

const IntentSchema = z.strictObject({
  billerId: z.string().regex(/^blr-\d{3}$/),
  reference: z
    .string()
    .min(4)
    .max(20)
    .regex(/^[A-Za-z0-9]+$/),
  debtId: z.string().regex(/^[A-Za-z0-9-]{5,60}$/),
  sourceAccountId: z.string().regex(/^acc-\d{3,6}$/),
});
const ConfirmSchema = z.strictObject({
  intentId: z.uuid(),
  stepUpToken: z.string().min(20).max(4096),
});

@Controller('v1')
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly accounts: AccountsPort,
  ) {}

  @Get('source-accounts')
  async sourceAccounts(@CurrentSession() s: Session) {
    return { items: await this.accounts.sourceAccounts(s.customerId) };
  }

  @Post('payment-intents')
  @HttpCode(201)
  intent(@CurrentSession() s: Session, @Body({ schema: IntentSchema }) body: z.infer<typeof IntentSchema>) {
    return this.payments.createIntent(s, body);
  }

  @Post('payments')
  @HttpCode(201)
  @UseInterceptors(IdempotencyInterceptor)
  pay(@CurrentSession() s: Session, @Body({ schema: ConfirmSchema }) body: z.infer<typeof ConfirmSchema>) {
    return this.payments.confirm(s, body.intentId, body.stepUpToken);
  }

  @Get('payments/:id')
  receipt(@CurrentSession() s: Session, @Param('id', { schema: z.uuid() }) id: string) {
    return this.payments.receipt(s, id);
  }
}
