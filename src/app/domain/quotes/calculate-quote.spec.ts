import { calculateQuote } from './calculate-quote';
import { createReferenceQuote } from './quote-fixtures';
import type { QuoteLine } from './quote-line';
import type { QuoteTotals } from './quote-totals';

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

function calculateLines(lines: readonly QuoteLine[]): QuoteTotals {
  const result = calculateQuote({ currency: 'EUR', lines });
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.totals;
}

describe('calculateQuote', () => {
  it('reproduce la referencia y separa mensualidades de pagos únicos', () => {
    const totals = calculateLines(createReferenceQuote().lines);

    expect(totals.calculationVersion).toBe(1);
    expect(totals.currency).toBe('EUR');
    expect(totals.combined).toEqual({
      gross: '1525.00',
      discount: '0.00',
      base: '1525.00',
      vat: '320.25',
      total: '1845.25',
    });
    expect(totals.monthly).toEqual({
      gross: '1330.00',
      discount: '0.00',
      base: '1330.00',
      vat: '279.30',
      total: '1609.30',
    });
    expect(totals.oneTime).toEqual({
      gross: '195.00',
      discount: '0.00',
      base: '195.00',
      vat: '40.95',
      total: '235.95',
    });
    expect(totals.lines.map((line) => line.total)).toEqual(['1452.00', '157.30', '235.95']);
    expect(totals.taxGroups).toHaveLength(2);
  });

  it('actualiza los importes al cambiar mantenimiento de ocho a diez sitios', () => {
    const quote = createReferenceQuote();
    quote.lines[0].quantity = '10';

    const totals = calculateLines(quote.lines);

    expect(totals.monthly.total).toBe('1972.30');
    expect(totals.oneTime.total).toBe('235.95');
    expect(totals.combined.total).toBe('2208.25');
  });

  it('aplica el descuento porcentual antes del IVA', () => {
    const totals = calculateLines([createLine({ discount: { kind: 'percentage', value: '10' } })]);

    expect(totals.combined).toEqual({
      gross: '100.00',
      discount: '10.00',
      base: '90.00',
      vat: '18.90',
      total: '108.90',
    });
  });

  it('aplica el descuento fijo una sola vez a toda la línea', () => {
    const totals = calculateLines([
      createLine({
        quantity: '2',
        unitPrice: '50.00',
        discount: { kind: 'fixed', value: '10.00' },
      }),
    ]);

    expect(totals.combined).toEqual({
      gross: '100.00',
      discount: '10.00',
      base: '90.00',
      vat: '18.90',
      total: '108.90',
    });
  });

  it('calcula tres unidades de diez céntimos sin errores de punto flotante', () => {
    const totals = calculateLines([createLine({ quantity: '3', unitPrice: '0.10' })]);

    expect(totals.combined).toEqual({
      gross: '0.30',
      discount: '0.00',
      base: '0.30',
      vat: '0.06',
      total: '0.36',
    });
  });

  it('admite cantidades fraccionarias', () => {
    const totals = calculateLines([createLine({ quantity: '2.5', unitPrice: '40.00' })]);

    expect(totals.combined).toEqual({
      gross: '100.00',
      discount: '0.00',
      base: '100.00',
      vat: '21.00',
      total: '121.00',
    });
  });

  it('agrupa bases de 100 al 21 % y de 50 al 10 %', () => {
    const totals = calculateLines([
      createLine(),
      createLine({ id: 'line-2', unitPrice: '50.00', vat: { kind: 'taxed', rate: '10' } }),
    ]);

    expect(totals.taxGroups).toHaveLength(2);
    expect(totals.taxGroups).toEqual(
      expect.arrayContaining([
        {
          frequency: 'monthly',
          treatment: { kind: 'taxed', rate: '21' },
          base: '100.00',
          vat: '21.00',
          total: '121.00',
        },
        {
          frequency: 'monthly',
          treatment: { kind: 'taxed', rate: '10' },
          base: '50.00',
          vat: '5.00',
          total: '55.00',
        },
      ]),
    );
    expect(totals.combined.vat).toBe('26.00');
    expect(totals.combined.total).toBe('176.00');
  });

  it('redondea una cuota de IVA de 0.105 a 0.11 con ROUND_HALF_UP', () => {
    const totals = calculateLines([createLine({ unitPrice: '0.50' })]);

    expect(totals.combined.vat).toBe('0.11');
    expect(totals.combined.total).toBe('0.61');
  });

  it('redondea primero el bruto, después el descuento y finalmente el IVA', () => {
    const totals = calculateLines([
      createLine({
        quantity: '0.335',
        unitPrice: '3.00',
        discount: { kind: 'percentage', value: '50' },
      }),
    ]);

    // 1.005 → 1.01; 0.505 → 0.51; base 0.50; IVA 0.105 → 0.11.
    expect(totals.combined).toEqual({
      gross: '1.01',
      discount: '0.51',
      base: '0.50',
      vat: '0.11',
      total: '0.61',
    });
  });

  it('suma las cuotas redondeadas de las líneas sin recalcular IVA sobre el grupo', () => {
    const totals = calculateLines([
      createLine({ unitPrice: '0.03' }),
      createLine({ id: 'line-2', unitPrice: '0.03' }),
    ]);

    expect(totals.taxGroups).toHaveLength(1);
    expect(totals.taxGroups[0]).toMatchObject({ base: '0.06', vat: '0.02', total: '0.08' });
    expect(totals.combined.vat).toBe('0.02');
  });

  it('agrupa tipos de IVA equivalentes aunque tengan distinto número de decimales', () => {
    const totals = calculateLines([
      createLine(),
      createLine({ id: 'line-2', vat: { kind: 'taxed', rate: '21.00' } }),
    ]);

    expect(totals.taxGroups).toHaveLength(1);
    expect(totals.taxGroups[0]).toMatchObject({ base: '200.00', vat: '42.00', total: '242.00' });
  });

  it('mantiene separados IVA al 0 %, exención y no sujeción', () => {
    const totals = calculateLines([
      createLine({ vat: { kind: 'taxed', rate: '0' } }),
      createLine({ id: 'line-2', vat: { kind: 'exempt', note: 'Exención de demostración.' } }),
      createLine({
        id: 'line-3',
        vat: { kind: 'not-subject', note: 'No sujeción de demostración.' },
      }),
    ]);

    expect(totals.taxGroups).toHaveLength(3);
    expect(totals.taxGroups.map((group) => group.treatment.kind).sort()).toEqual([
      'exempt',
      'not-subject',
      'taxed',
    ]);
    expect(totals.combined.base).toBe('300.00');
    expect(totals.combined.vat).toBe('0.00');
    expect(totals.combined.total).toBe('300.00');
  });

  it('permite un descuento del 100 % y conserva el bruto y el descuento', () => {
    const totals = calculateLines([createLine({ discount: { kind: 'percentage', value: '100' } })]);

    expect(totals.combined).toEqual({
      gross: '100.00',
      discount: '100.00',
      base: '0.00',
      vat: '0.00',
      total: '0.00',
    });
  });

  it('admite un descuento fijo igual al bruto ya redondeado', () => {
    const totals = calculateLines([
      createLine({
        quantity: '0.001',
        unitPrice: '5.00',
        discount: { kind: 'fixed', value: '0.01' },
      }),
    ]);

    expect(totals.combined.gross).toBe('0.01');
    expect(totals.combined.total).toBe('0.00');
  });

  it('devuelve cero en la periodicidad que no contiene conceptos', () => {
    const totals = calculateLines([createLine({ frequency: 'one-time', unitPrice: '0.00' })]);

    expect(totals.monthly).toEqual({
      gross: '0.00',
      discount: '0.00',
      base: '0.00',
      vat: '0.00',
      total: '0.00',
    });
    expect(totals.oneTime.total).toBe('0.00');
  });

  it('conserva la precisión al sumar el máximo de líneas e importes admitidos', () => {
    const totals = calculateLines(
      Array.from({ length: 1000 }, (_, index) =>
        createLine({
          id: `line-${index}`,
          quantity: '999999.999',
          unitPrice: '999999999.99',
          vat: { kind: 'taxed', rate: '100' },
        }),
      ),
    );

    expect(totals.combined.base).toBe('999999998990000000.00');
    expect(totals.combined.vat).toBe('999999998990000000.00');
    expect(totals.combined.total).toBe('1999999997980000000.00');
  });

  it('no modifica la entrada ni comparte el objeto de tratamiento fiscal con la salida', () => {
    const quote = createReferenceQuote();
    const before = JSON.stringify(quote);

    const totals = calculateLines(quote.lines);

    expect(JSON.stringify(quote)).toBe(before);
    const treatment = totals.taxGroups[0].treatment;
    if (treatment.kind === 'taxed') treatment.rate = '99';
    expect(JSON.stringify(quote)).toBe(before);
  });

  it('produce importes con dos decimales y un resultado serializable como JSON', () => {
    const result = calculateQuote(createReferenceQuote());

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    if (result.status !== 'valid') {
      throw new Error('La referencia debe ser válida.');
    }
    const amountSets = [
      ...result.totals.lines,
      result.totals.monthly,
      result.totals.oneTime,
      result.totals.combined,
    ];
    for (const amounts of amountSets) {
      for (const field of ['gross', 'discount', 'base', 'vat', 'total'] as const) {
        expect(amounts[field]).toMatch(/^\d+\.\d{2}$/);
      }
    }
  });

  it('devuelve incomplete sin totales cuando se vacía temporalmente un precio', () => {
    const line = createLine({ unitPrice: '' });
    const result = calculateQuote({ currency: 'EUR', lines: [line] });

    expect(result.status).toBe('incomplete');
    expect(result).not.toHaveProperty('totals');
    expect(line.unitPrice).toBe('');
    if (result.status !== 'valid') {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'required', field: 'unitPrice', lineId: line.id }),
      );
    }
  });

  it('devuelve invalid sin totales si el descuento fijo supera el bruto', () => {
    const result = calculateQuote({
      currency: 'EUR',
      lines: [createLine({ discount: { kind: 'fixed', value: '100.01' } })],
    });

    expect(result.status).toBe('invalid');
    expect(result).not.toHaveProperty('totals');
    if (result.status !== 'valid') {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'out-of-range', field: 'discount.value' }),
      );
    }
  });

  it('prioriza invalid cuando hay a la vez un campo vacío y otro erróneo', () => {
    const result = calculateQuote({
      currency: 'EUR',
      lines: [createLine({ quantity: '-1', unitPrice: '' })],
    });

    expect(result.status).toBe('invalid');
    expect(result).not.toHaveProperty('totals');
  });
});
