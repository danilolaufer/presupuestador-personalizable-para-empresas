import type { Quote } from './quote';
import type { QuoteTotals } from './quote-totals';
import { QuoteDecimal } from './quote-decimal';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Verifica los importes conservados y sus sumas, sin recalcular precios ni descuentos. */
export function validateStoredTotals(totals: QuoteTotals, quote: Quote): void {
  const amountKeys = ['gross', 'discount', 'base', 'vat', 'total'] as const;
  const money = (value: unknown): void => {
    check(
      typeof value === 'string' && /^(0|[1-9]\d{0,20})\.\d{2}$/.test(value),
      'Importe histórico inválido.',
    );
  };
  const amount = (value: unknown, full = true): void => {
    check(record(value), 'Falta un desglose de importes históricos.');
    for (const key of full ? amountKeys : ['base', 'vat', 'total']) money(value[key]);
    check(
      new QuoteDecimal(value['base'] as string)
        .plus(value['vat'] as string)
        .eq(value['total'] as string),
      'Base e IVA históricos no coinciden con el total.',
    );
    if (full)
      check(
        new QuoteDecimal(value['gross'] as string)
          .minus(value['discount'] as string)
          .eq(value['base'] as string),
        'Descuento histórico incoherente.',
      );
  };
  check(
    record(totals) &&
      totals.calculationVersion === quote.calculationVersion &&
      totals.currency === 'EUR' &&
      Array.isArray(totals.lines) &&
      Array.isArray(totals.taxGroups),
    'Versión o estructura de totales incompatible.',
  );
  check(
    totals.lines.length === quote.lines.length && totals.taxGroups.length <= quote.lines.length,
    'Desglose histórico incompleto.',
  );
  totals.lines.forEach((line, i) => {
    amount(line);
    check(
      line.lineId === quote.lines[i].id && line.frequency === quote.lines[i].frequency,
      'Las líneas y sus importes históricos no coinciden.',
    );
  });
  const sum = (items: { [key: string]: unknown }[], key: string) =>
    items.reduce((acc, item) => acc.plus(item[key] as string), new QuoteDecimal(0));
  for (const [key, frequency] of [
    ['monthly', 'monthly'],
    ['oneTime', 'one-time'],
    ['combined', null],
  ] as const) {
    amount(totals[key]);
    for (const field of amountKeys)
      check(
        sum(
          totals.lines.filter(
            (item) => !frequency || item.frequency === frequency,
          ) as unknown as Record<string, unknown>[],
          field,
        ).eq(totals[key][field]),
        'Las sumas históricas no coinciden.',
      );
  }
  const taxKey = (frequency: string, vat: Quote['lines'][number]['vat']) => {
    check(record(vat), 'Tratamiento fiscal histórico inválido.');
    if (vat.kind === 'taxed') {
      check(
        typeof vat.rate === 'string' &&
          vat.rate.length <= 64 &&
          /^(0|[1-9]\d*)(\.\d+)?$/.test(vat.rate),
        'Tipo de IVA histórico inválido.',
      );
      return JSON.stringify([frequency, 'taxed', new QuoteDecimal(vat.rate).toString()]);
    }
    check(
      (vat.kind === 'exempt' || vat.kind === 'not-subject') && typeof vat.note === 'string',
      'Tratamiento fiscal histórico inválido.',
    );
    return JSON.stringify([frequency, vat.kind, vat.note]);
  };
  const expected = new Map<string, { base: string; vat: string; total: string }[]>();
  quote.lines.forEach((line, i) => {
    const key = taxKey(line.frequency, line.vat);
    expected.set(key, [...(expected.get(key) ?? []), totals.lines[i]]);
  });
  for (const group of totals.taxGroups) {
    amount(group, false);
    const lines = expected.get(taxKey(group.frequency, group.treatment));
    check(lines, 'Grupo de IVA histórico duplicado o desconocido.');
    for (const key of ['base', 'vat', 'total'] as const)
      check(sum(lines, key).eq(group[key]), 'El desglose de IVA no coincide con las líneas.');
    expected.delete(taxKey(group.frequency, group.treatment));
  }
  check(expected.size === 0, 'Faltan grupos de IVA históricos.');
}
