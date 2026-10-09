import type { BillingFrequency, DecimalText, Vat } from './quote-line';

/** Importes serializables en EUR, siempre con dos decimales. */
export interface AmountTotals {
  gross: DecimalText;
  discount: DecimalText;
  base: DecimalText;
  vat: DecimalText;
  total: DecimalText;
}

export interface QuoteLineTotals extends AmountTotals {
  lineId: string;
  frequency: BillingFrequency;
}

export interface TaxGroupTotals {
  frequency: BillingFrequency;
  treatment: Vat;
  base: DecimalText;
  vat: DecimalText;
  total: DecimalText;
}

export interface QuoteTotals {
  calculationVersion: 1;
  currency: 'EUR';
  lines: QuoteLineTotals[];
  taxGroups: TaxGroupTotals[];
  monthly: AmountTotals;
  oneTime: AmountTotals;
  /** Conjunto de conceptos; no implica duración contractual ni acuerdo de pago inicial. */
  combined: AmountTotals;
}
