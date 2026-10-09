import type { QuoteCalculationInput } from './quote';
import { createReferenceQuote } from './quote-fixtures';
import type { QuoteLine } from './quote-line';
import { validateQuote, validateQuoteForDocument } from './validate-quote';

function createLine(overrides: Partial<QuoteLine> = {}): QuoteLine {
  return {
    id: 'line-1',
    name: 'Servicio ficticio',
    description: '',
    unit: 'hora',
    quantity: '1',
    unitPrice: '100.00',
    frequency: 'monthly',
    discount: { kind: 'none' },
    vat: { kind: 'taxed', rate: '21' },
    ...overrides,
  };
}

function validateLine(overrides: Partial<QuoteLine>) {
  return validateQuote({ currency: 'EUR', lines: [createLine(overrides)] });
}

describe('validateQuote', () => {
  it('acepta los datos de referencia', () => {
    expect(validateQuote(createReferenceQuote())).toEqual([]);
  });

  it('permite datos descriptivos incompletos para calcular el borrador', () => {
    expect(validateLine({ name: '', unit: '', vat: { kind: 'exempt', note: '' } })).toEqual([]);
  });

  it.each(['0', '-1'])('rechaza la cantidad no positiva %s', (quantity) => {
    expect(validateLine({ quantity })).toContainEqual(
      expect.objectContaining({ field: 'quantity' }),
    );
  });

  it('rechaza un precio negativo pero permite cero', () => {
    expect(validateLine({ unitPrice: '-0.01' })).toContainEqual(
      expect.objectContaining({ field: 'unitPrice' }),
    );
    expect(validateLine({ unitPrice: '0.00' })).toEqual([]);
  });

  it.each(['NaN', 'Infinity', '-Infinity', '1e2', '1,25', ' 1.25 ', '1.000,00', '.5', '1.'])(
    'rechaza el decimal ambiguo o no canónico %s',
    (unitPrice) => {
      expect(validateLine({ unitPrice })).toContainEqual(
        expect.objectContaining({ field: 'unitPrice', code: 'invalid-decimal' }),
      );
    },
  );

  it('no convierte un número JavaScript en un decimal de texto silenciosamente', () => {
    expect(validateLine({ unitPrice: 100 as unknown as string })).toContainEqual(
      expect.objectContaining({ field: 'unitPrice', code: 'invalid-decimal' }),
    );
  });

  it.each([
    { quantity: '' },
    { unitPrice: '' },
    { discount: { kind: 'percentage', value: '' } },
    { vat: { kind: 'taxed', rate: '' } },
  ] satisfies Partial<QuoteLine>[])(
    'identifica como requerido el decimal vacío: %j',
    (overrides) => {
      const errors = validateLine(overrides);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'required', lineId: 'line-1', lineIndex: 0 });
      expect(errors[0].message.length).toBeGreaterThan(0);
    },
  );

  it.each([
    { quantity: '0.0001' },
    { unitPrice: '0.001' },
    { discount: { kind: 'percentage', value: '1.001' } },
    { discount: { kind: 'fixed', value: '0.001' } },
    { vat: { kind: 'taxed', rate: '21.001' } },
  ] satisfies Partial<QuoteLine>[])('rechaza más decimales que los permitidos: %j', (overrides) => {
    expect(validateLine(overrides)).not.toEqual([]);
  });

  it.each([
    { quantity: '1000000' },
    { unitPrice: '1000000000.00' },
    { discount: { kind: 'fixed', value: '1000000000000000.00' } },
  ] satisfies Partial<QuoteLine>[])(
    'rechaza importes que exceden los límites técnicos: %j',
    (overrides) => {
      expect(validateLine(overrides)).toContainEqual(
        expect.objectContaining({ code: 'out-of-range' }),
      );
    },
  );

  it.each(['-0.01', '100.01'])('rechaza un descuento porcentual fuera de 0 a 100: %s', (value) => {
    expect(validateLine({ discount: { kind: 'percentage', value } })).toContainEqual(
      expect.objectContaining({ field: 'discount.value' }),
    );
  });

  it.each(['-0.01', '100.01'])('rechaza un tipo de IVA fuera de 0 a 100: %s', (rate) => {
    expect(validateLine({ vat: { kind: 'taxed', rate } })).toContainEqual(
      expect.objectContaining({ field: 'vat.rate' }),
    );
  });

  it('rechaza descuentos fijos negativos o superiores al bruto', () => {
    for (const value of ['-0.01', '100.01']) {
      expect(validateLine({ discount: { kind: 'fixed', value } })).toContainEqual(
        expect.objectContaining({ field: 'discount.value' }),
      );
    }
  });

  it('requiere al menos una línea', () => {
    expect(validateQuote({ currency: 'EUR', lines: [] })).toContainEqual(
      expect.objectContaining({ code: 'required', field: 'lines' }),
    );
  });

  it('rechaza más de mil líneas', () => {
    const lines = Array.from({ length: 1001 }, (_, index) => createLine({ id: `line-${index}` }));

    expect(validateQuote({ currency: 'EUR', lines })).toContainEqual(
      expect.objectContaining({ code: 'out-of-range', field: 'lines' }),
    );
  });

  it('requiere identificadores estables y únicos dentro del presupuesto', () => {
    expect(validateLine({ id: '' })).toContainEqual(
      expect.objectContaining({ code: 'required', field: 'id' }),
    );
    expect(validateQuote({ currency: 'EUR', lines: [createLine(), createLine()] })).toContainEqual(
      expect.objectContaining({
        code: 'duplicate-id',
        field: 'id',
        lineId: 'line-1',
        lineIndex: 1,
      }),
    );
  });

  it('rechaza otra moneda o periodicidad aunque la entrada eluda TypeScript', () => {
    const input = { currency: 'USD', lines: [createLine()] } as unknown as QuoteCalculationInput;

    expect(validateQuote(input)).toContainEqual(
      expect.objectContaining({ code: 'invalid-value', field: 'currency' }),
    );
    expect(validateLine({ frequency: 'annual' as QuoteLine['frequency'] })).toContainEqual(
      expect.objectContaining({ code: 'invalid-value', field: 'frequency' }),
    );
  });
});

describe('validateQuoteForDocument', () => {
  it('acepta el documento ficticio completo', () => {
    expect(validateQuoteForDocument(createReferenceQuote())).toEqual([]);
  });

  it('exige datos descriptivos y de cabecera que no hacen falta para calcular', () => {
    const quote = createReferenceQuote();
    quote.number = '';
    quote.issuer.name = '';
    quote.client.taxId = '';
    quote.client.address = '';
    quote.lines[0].name = '';
    quote.lines[0].unit = '';
    quote.payment.method = '';
    quote.payment.instructions = '';
    quote.conditions.terms = '';

    expect(validateQuote(quote)).toEqual([]);
    const errors = validateQuoteForDocument(quote);
    for (const field of [
      'number',
      'issuer.name',
      'client.taxId',
      'client.address',
      'name',
      'unit',
      'payment.method',
      'payment.instructions',
      'conditions.terms',
    ]) {
      expect(errors).toContainEqual(expect.objectContaining({ code: 'required', field }));
    }
  });

  it.each(['exempt', 'not-subject'] as const)(
    'exige explicar el tratamiento fiscal %s antes de emitir',
    (kind) => {
      const quote = createReferenceQuote();
      quote.lines[0].vat = { kind, note: '' };

      expect(validateQuote(quote)).toEqual([]);
      expect(validateQuoteForDocument(quote)).toContainEqual(
        expect.objectContaining({ code: 'required', field: 'vat.note', lineId: quote.lines[0].id }),
      );
    },
  );

  it('incluye también los errores numéricos de cálculo', () => {
    const quote = createReferenceQuote();
    quote.lines[0].quantity = '0';

    expect(validateQuoteForDocument(quote)).toContainEqual(
      expect.objectContaining({ code: 'out-of-range', field: 'quantity' }),
    );
  });

  it('distingue fechas vacías de fechas civiles inválidas', () => {
    const quote = createReferenceQuote();
    quote.issueDate = '';
    quote.validUntil = '2026-02-30';

    expect(validateQuoteForDocument(quote)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'required', field: 'issueDate' }),
        expect.objectContaining({ code: 'invalid-value', field: 'validUntil' }),
      ]),
    );
  });

  it('acepta el 29 de febrero de un año bisiesto y rechaza el de un año normal', () => {
    const quote = createReferenceQuote();
    quote.issueDate = '2024-02-29';
    quote.validUntil = '2024-03-01';
    expect(validateQuoteForDocument(quote)).toEqual([]);

    quote.issueDate = '2025-02-29';
    quote.validUntil = '2025-03-01';
    expect(validateQuoteForDocument(quote)).toContainEqual(
      expect.objectContaining({ code: 'invalid-value', field: 'issueDate' }),
    );
  });

  it('no admite una validez anterior a la emisión y permite el mismo día', () => {
    const quote = createReferenceQuote();
    quote.validUntil = '2026-09-16';
    expect(validateQuoteForDocument(quote)).toContainEqual(
      expect.objectContaining({ code: 'out-of-range', field: 'validUntil' }),
    );

    quote.validUntil = quote.issueDate;
    expect(validateQuoteForDocument(quote)).toEqual([]);
  });
});
