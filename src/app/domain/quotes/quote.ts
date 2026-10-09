import type { QuoteLine } from './quote-line';
import type { QuoteTotals } from './quote-totals';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

export interface PartySnapshot {
  name: string;
  taxId: string;
  address: string;
  email: string;
  phone: string;
}

export interface BrandSnapshot {
  name: string;
  logoDataUrl: string | null;
  accentColor: string;
}

export interface PaymentSnapshot {
  method: string;
  holder: string;
  instructions: string;
  iban: string;
}

export interface QuoteConditions {
  terms: string;
  notes: string;
  includesFirstMonthlyPayment: boolean;
}

export interface QuoteCalculationInput {
  currency: 'EUR';
  lines: readonly QuoteLine[];
}

interface QuoteContent extends QuoteCalculationInput {
  id: string;
  number: string;
  title: string;
  /** Fechas civiles YYYY-MM-DD, independientes del número visible. */
  issueDate: string;
  validUntil: string;
  issuer: PartySnapshot;
  client: PartySnapshot;
  brand: BrandSnapshot;
  payment: PaymentSnapshot;
  conditions: QuoteConditions;
  schemaVersion: 2;
  calculationVersion: 1;
  revision: number;
  revisionOfId?: string;
  /** Instantes ISO con zona horaria. */
  createdAt: string;
  updatedAt: string;
}

export interface DraftQuote extends QuoteContent {
  status: 'draft';
}

/** El modelo exige conservar los resultados al cerrar un borrador. */
export interface FinalizedQuote extends QuoteContent {
  status: Exclude<QuoteStatus, 'draft'>;
  totals: QuoteTotals;
}

export type Quote = DraftQuote | FinalizedQuote;
