import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AccountsPort, BillersPort, type Currency } from '../core/recaudos.port.js';
import type { RecaudosSession } from '../session/session.store.js';
import { TrustedTokensService } from '../session/trusted-tokens.service.js';

export interface CreateIntentInput {
  billerId: string;
  reference: string;
  debtId: string;
  sourceAccountId: string;
}

interface Intent extends CreateIntentInput {
  id: string;
  customerId: string;
  billerName: string;
  amount: number;
  fee: number;
  total: number;
  currency: Currency;
  hash: string;
  expiresAt: number;
}

interface Receipt {
  paymentId: string;
  customerId: string;
  billerName: string;
  reference: string;
  total: number;
  currency: Currency;
  sourceAccount: string;
  authorizationCode: string;
  operationId: string;
  executedAt: string;
}

const INTENT_TTL_MS = 5 * 60 * 1000;

/**
 * Pago en dos fases:
 * 1) intent: el servidor fija monto, comisión y cuenta, y calcula un hash
 *    canónico de la operación.
 * 2) confirm: exige un step-up token firmado por mse-banca-movil (tras la
 *    biometría nativa) cuyo `txn` sea ese hash y cuyo monto coincida.
 *    Así ni el WebView ni un atacante pueden alterar la operación aprobada.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly intents = new Map<string, Intent>();
  private readonly receipts = new Map<string, Receipt>();

  constructor(
    private readonly billers: BillersPort,
    private readonly accounts: AccountsPort,
    private readonly tokens: TrustedTokensService,
  ) {}

  async createIntent(session: RecaudosSession, input: CreateIntentInput) {
    const biller = await this.billers.biller(input.billerId);
    if (!biller) throw new NotFoundException('Empresa no encontrada');
    const debt = (await this.billers.debts(input.billerId, input.reference)).find((d) => d.id === input.debtId);
    if (!debt) throw new UnprocessableEntityException('Deuda no encontrada o ya pagada');
    const account = (await this.accounts.sourceAccounts(session.customerId)).find(
      (a) => a.id === input.sourceAccountId,
    );
    if (!account) throw new ForbiddenException('Cuenta no pertenece al cliente');
    if (account.currency !== debt.currency) throw new UnprocessableEntityException('Moneda no coincide');

    const total = Math.round((debt.amount + biller.fee) * 100) / 100;
    if (account.availableBalance < total) throw new UnprocessableEntityException('Fondos insuficientes');

    const id = randomUUID();
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          id,
          session.customerId,
          input.billerId,
          input.reference,
          input.debtId,
          input.sourceAccountId,
          total,
          debt.currency,
        ]),
      )
      .digest('hex');
    this.intents.set(id, {
      ...input,
      id,
      customerId: session.customerId,
      billerName: biller.name,
      amount: debt.amount,
      fee: biller.fee,
      total,
      currency: debt.currency,
      hash,
      expiresAt: Date.now() + INTENT_TTL_MS,
    });
    return {
      intentId: id,
      intentHash: hash,
      billerName: biller.name,
      reference: input.reference,
      description: debt.description,
      amount: debt.amount,
      fee: biller.fee,
      total,
      currency: debt.currency,
      sourceAccount: account.numberMasked,
      expiresIn: INTENT_TTL_MS / 1000,
    };
  }

  async confirm(session: RecaudosSession, intentId: string, stepUpToken: string) {
    const intent = this.intents.get(intentId);
    if (!intent || intent.customerId !== session.customerId || intent.expiresAt < Date.now()) {
      throw new NotFoundException('Operación no encontrada o expirada');
    }
    const claims = await this.tokens.verifyStepUp(stepUpToken);
    if (
      claims.sub !== session.customerId ||
      claims.sid !== session.parentSid ||
      claims.txn !== intent.hash ||
      claims.amt !== intent.total ||
      claims.cur !== intent.currency
    ) {
      this.logger.warn({ msg: 'payment.stepup.mismatch', intentId });
      throw new ForbiddenException('La autorización no corresponde a la operación');
    }
    this.intents.delete(intentId); // un solo uso

    const result = await this.accounts.debitForBill({
      customerId: session.customerId,
      accountId: intent.sourceAccountId,
      billerId: intent.billerId,
      reference: intent.reference,
      debtId: intent.debtId,
      amount: intent.total,
      currency: intent.currency,
    });
    const account = (await this.accounts.sourceAccounts(session.customerId)).find(
      (a) => a.id === intent.sourceAccountId,
    );
    const receipt: Receipt = {
      paymentId: randomUUID(),
      customerId: session.customerId,
      billerName: intent.billerName,
      reference: intent.reference,
      total: intent.total,
      currency: intent.currency,
      sourceAccount: account?.numberMasked ?? '',
      ...result,
    };
    this.receipts.set(receipt.paymentId, receipt);
    this.logger.log({ msg: 'payment.executed', paymentId: receipt.paymentId, operationId: result.operationId });
    return this.toDto(receipt);
  }

  receipt(session: RecaudosSession, paymentId: string) {
    const r = this.receipts.get(paymentId);
    if (!r || r.customerId !== session.customerId) throw new NotFoundException(); // BOLA
    return this.toDto(r);
  }

  private toDto({ customerId: _c, ...r }: Receipt) {
    return { status: 'COMPLETED', ...r };
  }
}
