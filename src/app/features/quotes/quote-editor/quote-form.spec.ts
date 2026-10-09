import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import {
  createQuoteForm,
  normalizeDecimalInput,
  quoteFormIssues,
  readQuoteForm,
  replaceQuoteForm,
} from './quote-form';

describe('Formulario tipado del presupuesto', () => {
  it('conserva todos los datos del documento al convertir de dominio a formulario y volver', () => {
    const quote = createReferenceQuote();
    quote.lines[0].sourceServiceId = 'catalog-demo';
    const form = createQuoteForm(quote);

    expect(readQuoteForm(form)).toEqual(quote);
    expect(form.valid).toBe(true);
    form.controls.issuer.controls.name.setValue('Otro emisor ficticio');
    expect(quote.issuer.name).toBe('Estudio Nube de Ejemplo');
  });

  it.each([
    ['150,25', '150.25'],
    [' 2,5 ', '2.5'],
    ['0010.00', '10.00'],
    ['', ''],
    ['   ', ''],
    ['1.234,56', '1.234,56'],
    ['1,2,3', '1,2,3'],
    ['1e2', '1e2'],
  ])('normaliza %j como %j sin interpretar formatos ambiguos', (raw, expected) => {
    expect(normalizeDecimalInput(raw)).toBe(expected);
  });

  it('mantiene el texto original en el control al normalizar una proyección decimal', () => {
    const form = createQuoteForm(createReferenceQuote());
    form.controls.lines.at(0).controls.quantity.setValue('2,5');
    form.controls.lines.at(0).controls.unitPrice.setValue('');

    const quote = readQuoteForm(form);
    expect(quote.lines[0].quantity).toBe('2.5');
    expect(quote.lines[0].unitPrice).toBe('');
    expect(form.controls.lines.at(0).controls.quantity.value).toBe('2,5');
    expect(calculateQuote(quote).status).toBe('incomplete');
    expect(quoteFormIssues(form)).toContainEqual(
      expect.objectContaining({ field: 'unitPrice', code: 'required' }),
    );
  });

  it('aplica las reglas de descuento y fechas del dominio como errores del formulario', () => {
    const form = createQuoteForm(createReferenceQuote());
    form.controls.lines.at(0).controls.discount.setValue({ kind: 'fixed', value: '9999' });
    form.controls.validUntil.setValue('2026-09-16');

    expect(form.invalid).toBe(true);
    expect(quoteFormIssues(form)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'discount.value', code: 'out-of-range' }),
        expect.objectContaining({ field: 'validUntil', code: 'out-of-range' }),
      ]),
    );
  });

  it('ignora valores ocultos del descuento e IVA sin borrar lo que se había escrito', () => {
    const form = createQuoteForm(createReferenceQuote());
    const line = form.controls.lines.at(0);
    line.controls.discount.setValue({ kind: 'none', value: 'valor pendiente' });
    line.controls.vat.setValue({ kind: 'exempt', rate: '', note: 'Exención ficticia' });
    expect(form.valid).toBe(true);
    expect(readQuoteForm(form).lines[0].discount).toEqual({ kind: 'none' });
    expect(readQuoteForm(form).lines[0].vat).toEqual({ kind: 'exempt', note: 'Exención ficticia' });
    line.controls.discount.controls.kind.setValue('fixed');
    expect(form.invalid).toBe(true);
    expect(line.controls.discount.controls.value.value).toBe('valor pendiente');
  });

  it('acepta un correo opcional vacío y detecta un correo escrito incorrectamente', () => {
    const form = createQuoteForm(createReferenceQuote());
    form.controls.client.controls.email.setValue('correo-incompleto');
    expect(form.invalid).toBe(true);
    form.controls.client.controls.email.setValue('');
    expect(form.valid).toBe(true);
  });

  it('reemplaza el ejemplo sin acumular líneas ni mantener valores del formulario anterior', () => {
    const form = createQuoteForm(createReferenceQuote());
    const originalForm = form;
    form.controls.conditions.controls.notes.setValue('Observación anterior');
    replaceQuoteForm(form, createReferenceQuote());
    expect(form).toBe(originalForm);
    expect(form.controls.lines.length).toBe(3);
    expect(form.controls.conditions.controls.notes.value).toBe('');
    expect(form.dirty).toBe(true);
    expect(form.valid).toBe(true);
  });
});
