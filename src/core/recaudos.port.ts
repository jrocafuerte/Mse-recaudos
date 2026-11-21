export type Currency = 'USD' | 'PEN' | 'COP' | 'MXN';

export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Biller {
  id: string;
  categoryId: string;
  name: string;
  referenceLabel: string;
  /** Regex de validación de la referencia (nro. de suministro, contrato, teléfono…). */
  referencePattern: string;
  fee: number;
}

export interface Debt {
  id: string;
  description: string;
  dueDate: string;
  amount: number;
  currency: Currency;
}

export interface SourceAccount {
  id: string;
  numberMasked: string;
  type: 'SAVINGS' | 'CHECKING';
  currency: Currency;
  availableBalance: number;
}

export interface PaymentResult {
  operationId: string;
  authorizationCode: string;
  executedAt: string;
}

/** Puerto hacia el agregador de recaudos / convenios con empresas. */
export abstract class BillersPort {
  abstract categories(): Promise<Category[]>;
  abstract billers(filter: { categoryId?: string; q?: string }): Promise<Biller[]>;
  abstract biller(id: string): Promise<Biller | undefined>;
  abstract debts(billerId: string, reference: string): Promise<Debt[]>;
}

/** Puerto hacia el core bancario (cuentas y débito). */
export abstract class AccountsPort {
  abstract sourceAccounts(customerId: string): Promise<SourceAccount[]>;
  abstract debitForBill(params: {
    customerId: string;
    accountId: string;
    billerId: string;
    reference: string;
    debtId: string;
    amount: number;
    currency: Currency;
  }): Promise<PaymentResult>;
}
