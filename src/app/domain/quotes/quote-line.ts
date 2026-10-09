/** Decimal canónico con punto; puede ser '' en un borrador. Se valida al calcular. */
export type DecimalText = string;

export type BillingFrequency = 'one-time' | 'monthly';

export type Discount =
  | { kind: 'none' }
  | { kind: 'percentage'; value: DecimalText }
  | { kind: 'fixed'; value: DecimalText };

export type Vat =
  | { kind: 'taxed'; rate: DecimalText }
  | { kind: 'exempt'; note: string }
  | { kind: 'not-subject'; note: string };

export interface QuoteLine {
  id: string;
  /** Referencia de origen; el resto de los campos son una copia independiente. */
  sourceServiceId?: string;
  name: string;
  description: string;
  unit: string;
  quantity: DecimalText;
  unitPrice: DecimalText;
  frequency: BillingFrequency;
  discount: Discount;
  vat: Vat;
}
