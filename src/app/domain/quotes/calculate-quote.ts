import type { QuoteCalculationInput } from './quote';
import { QuoteDecimal } from './quote-decimal';
import type { QuoteLine, Vat } from './quote-line';
import type { AmountTotals, QuoteLineTotals, QuoteTotals, TaxGroupTotals } from './quote-totals';
import { validateQuote, type ValidationIssue } from './validate-quote';

export type QuoteCalculationResult =
  | { status: 'valid'; totals: QuoteTotals }
  | { status: 'incomplete' | 'invalid'; errors: ValidationIssue[] };

function calculateLine(line: QuoteLine): QuoteLineTotals {
  const gross = new QuoteDecimal(line.quantity).times(line.unitPrice).toDecimalPlaces(2);
  let discount = new QuoteDecimal('0');
  if (line.discount.kind === 'percentage') {
    discount = gross.times(line.discount.value).dividedBy('100').toDecimalPlaces(2);
  } else if (line.discount.kind === 'fixed') {
    discount = new QuoteDecimal(line.discount.value).toDecimalPlaces(2);
  }
  const base = gross.minus(discount);
  const vat =
    line.vat.kind === 'taxed'
      ? base.times(line.vat.rate).dividedBy('100').toDecimalPlaces(2)
      : new QuoteDecimal('0');

  return {
    lineId: line.id,
    frequency: line.frequency,
    gross: gross.toFixed(2),
    discount: discount.toFixed(2),
    base: base.toFixed(2),
    vat: vat.toFixed(2),
    total: base.plus(vat).toFixed(2),
  };
}

function sumAmounts(lines: readonly AmountTotals[]): AmountTotals {
  const sum = (field: keyof AmountTotals): string =>
    lines.reduce((total, line) => total.plus(line[field]), new QuoteDecimal('0')).toFixed(2);

  return {
    gross: sum('gross'),
    discount: sum('discount'),
    base: sum('base'),
    vat: sum('vat'),
    total: sum('total'),
  };
}

function normalizeVat(vat: Vat): Vat {
  return vat.kind === 'taxed'
    ? { kind: 'taxed', rate: new QuoteDecimal(vat.rate).toString() }
    : { kind: vat.kind, note: vat.note };
}

function groupTaxes(input: QuoteCalculationInput, lines: QuoteLineTotals[]): TaxGroupTotals[] {
  const groups = new Map<string, TaxGroupTotals>();
  input.lines.forEach((line, index) => {
    const treatment = normalizeVat(line.vat);
    // Las notas distintas conservan su propio grupo para no perder el motivo fiscal.
    const key = JSON.stringify([line.frequency, treatment]);
    const amounts = lines[index];
    const group = groups.get(key);
    if (group) {
      group.base = new QuoteDecimal(group.base).plus(amounts.base).toFixed(2);
      group.vat = new QuoteDecimal(group.vat).plus(amounts.vat).toFixed(2);
      group.total = new QuoteDecimal(group.total).plus(amounts.total).toFixed(2);
    } else {
      groups.set(key, {
        frequency: line.frequency,
        treatment,
        base: amounts.base,
        vat: amounts.vat,
        total: amounts.total,
      });
    }
  });
  return [...groups.values()];
}

/** Política v1: bruto → descuento → base → IVA, redondeando por línea con HALF_UP. */
export function calculateQuote(input: QuoteCalculationInput): QuoteCalculationResult {
  const errors = validateQuote(input);
  if (errors.length > 0) {
    return {
      status: errors.some((error) => error.code !== 'required') ? 'invalid' : 'incomplete',
      errors,
    };
  }

  const lines = input.lines.map(calculateLine);
  return {
    status: 'valid',
    totals: {
      calculationVersion: 1,
      currency: 'EUR',
      lines,
      taxGroups: groupTaxes(input, lines),
      monthly: sumAmounts(lines.filter((line) => line.frequency === 'monthly')),
      oneTime: sumAmounts(lines.filter((line) => line.frequency === 'one-time')),
      combined: sumAmounts(lines),
    },
  };
}
