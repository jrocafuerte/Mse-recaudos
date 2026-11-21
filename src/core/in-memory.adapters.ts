import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import {
  AccountsPort,
  type Biller,
  BillersPort,
  type Category,
  type Debt,
  type PaymentResult,
  type SourceAccount,
} from './recaudos.port.js';

/** Adaptadores en memoria SOLO para desarrollo y pruebas (datos ficticios). */
@Injectable()
export class InMemoryBillers extends BillersPort {
  private readonly cats: Category[] = [
    { id: 'electricity', name: 'Luz', icon: 'bolt' },
    { id: 'water', name: 'Agua', icon: 'water' },
    { id: 'telecom', name: 'Telefonía e Internet', icon: 'wifi' },
    { id: 'education', name: 'Educación', icon: 'school' },
  ];
  private readonly list: Biller[] = [
    {
      id: 'blr-001',
      categoryId: 'electricity',
      name: 'Energía del Norte',
      referenceLabel: 'Nro. de suministro',
      referencePattern: '^\\d{6,10}$',
      fee: 0,
    },
    {
      id: 'blr-002',
      categoryId: 'water',
      name: 'Aguas Metropolitanas',
      referenceLabel: 'Código de cliente',
      referencePattern: '^\\d{8}$',
      fee: 0,
    },
    {
      id: 'blr-003',
      categoryId: 'telecom',
      name: 'Telco Móvil',
      referenceLabel: 'Número de teléfono',
      referencePattern: '^9\\d{8}$',
      fee: 0.5,
    },
    {
      id: 'blr-004',
      categoryId: 'education',
      name: 'Universidad Central',
      referenceLabel: 'Código de alumno',
      referencePattern: '^[A-Z]{2}\\d{6}$',
      fee: 1,
    },
  ];
  private readonly paid = new Set<string>();

  async categories() {
    return this.cats;
  }
  async billers({ categoryId, q }: { categoryId?: string; q?: string }) {
    const term = q?.toLowerCase();
    return this.list.filter(
      (b) => (!categoryId || b.categoryId === categoryId) && (!term || b.name.toLowerCase().includes(term)),
    );
  }
  async biller(id: string) {
    return this.list.find((b) => b.id === id);
  }
  async debts(billerId: string, reference: string): Promise<Debt[]> {
    const seed = Number(reference.replace(/\D/g, '').slice(-3) || '7');
    return [
      {
        id: `${billerId}-${reference}-1`,
        description: 'Recibo Octubre 2026',
        dueDate: '2026-11-28',
        amount: 40 + (seed % 60),
        currency: 'USD' as const,
      },
      {
        id: `${billerId}-${reference}-2`,
        description: 'Recibo Noviembre 2026',
        dueDate: '2026-12-28',
        amount: 35 + (seed % 45),
        currency: 'USD' as const,
      },
    ].filter((d) => !this.paid.has(d.id));
  }
  markPaid(debtId: string) {
    this.paid.add(debtId);
  }
}

@Injectable()
export class InMemoryAccounts extends AccountsPort {
  private readonly accounts = new Map<string, (SourceAccount & { ownerId: string })[]>([
    [
      'cus-0001',
      [
        {
          id: 'acc-001',
          numberMasked: '•••5566',
          type: 'SAVINGS',
          currency: 'USD',
          availableBalance: 5420.35,
          ownerId: 'cus-0001',
        },
        {
          id: 'acc-002',
          numberMasked: '•••6655',
          type: 'CHECKING',
          currency: 'USD',
          availableBalance: 1250,
          ownerId: 'cus-0001',
        },
      ],
    ],
  ]);

  constructor(private readonly billers: InMemoryBillers) {
    super();
  }

  async sourceAccounts(customerId: string): Promise<SourceAccount[]> {
    return (this.accounts.get(customerId) ?? []).map(({ ownerId: _o, ...a }) => a);
  }

  async debitForBill(p: Parameters<AccountsPort['debitForBill']>[0]): Promise<PaymentResult> {
    const acc = this.accounts.get(p.customerId)?.find((a) => a.id === p.accountId);
    if (!acc || acc.availableBalance < p.amount) throw new UnprocessableEntityException('Fondos insuficientes');
    acc.availableBalance = Math.round((acc.availableBalance - p.amount) * 100) / 100;
    this.billers.markPaid(p.debtId);
    return {
      operationId: randomUUID(),
      authorizationCode: randomInt(0, 1_000_000).toString().padStart(6, '0'),
      executedAt: new Date().toISOString(),
    };
  }
}
