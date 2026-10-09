import Decimal from 'decimal.js';

/** Configuración local: otros consumidores de decimal.js no alteran esta política. */
export const QuoteDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

// Con estos límites, ni productos ni sumas de hasta 1000 líneas agotan 40 cifras.
export const QUOTE_LIMITS = {
  maxLines: 1000,
  quantity: { integerDigits: 6, decimalPlaces: 3 },
  unitPrice: { integerDigits: 9, decimalPlaces: 2 },
  fixedDiscount: { integerDigits: 15, decimalPlaces: 2 },
  percentage: { integerDigits: 3, decimalPlaces: 2 },
} as const;
