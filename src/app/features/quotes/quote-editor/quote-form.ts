import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import type { DraftQuote, PartySnapshot } from '../../../domain/quotes/quote';
import type { BillingFrequency, Discount, QuoteLine, Vat } from '../../../domain/quotes/quote-line';
import {
  validateQuoteForDocument,
  type ValidationIssue,
} from '../../../domain/quotes/validate-quote';

type Controls<T> = { [Key in keyof T]: FormControl<T[Key]> };
export type PartyForm = FormGroup<Controls<PartySnapshot>>;
type QuoteMetadata = Omit<
  DraftQuote,
  | 'number'
  | 'title'
  | 'issueDate'
  | 'validUntil'
  | 'issuer'
  | 'client'
  | 'payment'
  | 'conditions'
  | 'lines'
>;

export type QuoteLineForm = FormGroup<{
  id: FormControl<string>;
  sourceServiceId: FormControl<string>;
  name: FormControl<string>;
  description: FormControl<string>;
  unit: FormControl<string>;
  quantity: FormControl<string>;
  unitPrice: FormControl<string>;
  frequency: FormControl<BillingFrequency>;
  discount: FormGroup<{ kind: FormControl<Discount['kind']>; value: FormControl<string> }>;
  vat: FormGroup<{
    kind: FormControl<Vat['kind']>;
    rate: FormControl<string>;
    note: FormControl<string>;
  }>;
}>;

export type QuoteForm = FormGroup<{
  metadata: FormControl<QuoteMetadata>;
  number: FormControl<string>;
  title: FormControl<string>;
  issueDate: FormControl<string>;
  validUntil: FormControl<string>;
  issuer: PartyForm;
  client: PartyForm;
  payment: FormGroup<Controls<DraftQuote['payment']>>;
  conditions: FormGroup<Controls<DraftQuote['conditions']>>;
  lines: FormArray<QuoteLineForm>;
}>;

function control<T>(value: T): FormControl<T> {
  return new FormControl(value, { nonNullable: true });
}

function createPartyForm(party: PartySnapshot): PartyForm {
  return new FormGroup({
    name: control(party.name),
    taxId: control(party.taxId),
    address: control(party.address),
    email: new FormControl(party.email, { nonNullable: true, validators: Validators.email }),
    phone: control(party.phone),
  });
}

export function createBlankLine(): QuoteLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    unit: '',
    quantity: '1',
    unitPrice: '',
    frequency: 'one-time',
    discount: { kind: 'none' },
    vat: { kind: 'taxed', rate: '' },
  };
}

export function createBlankQuote(): DraftQuote {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const emptyParty = (): PartySnapshot => ({
    name: '',
    taxId: '',
    address: '',
    email: '',
    phone: '',
  });
  return {
    id: crypto.randomUUID(),
    number: '',
    title: '',
    issueDate: date,
    validUntil: '',
    status: 'draft',
    currency: 'EUR',
    issuer: emptyParty(),
    client: emptyParty(),
    brand: { name: '', logoDataUrl: null, accentColor: '#125e57' },
    payment: { method: '', holder: '', instructions: '', iban: '' },
    conditions: { terms: '', notes: '', includesFirstMonthlyPayment: false },
    schemaVersion: 2,
    calculationVersion: 1,
    revision: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lines: [],
  };
}

export function createLineForm(line: QuoteLine = createBlankLine()): QuoteLineForm {
  return new FormGroup({
    id: control(line.id),
    sourceServiceId: control(line.sourceServiceId ?? ''),
    name: control(line.name),
    description: control(line.description),
    unit: control(line.unit),
    quantity: control(line.quantity),
    unitPrice: control(line.unitPrice),
    frequency: control(line.frequency),
    discount: new FormGroup({
      kind: control(line.discount.kind),
      value: control(line.discount.kind === 'none' ? '' : line.discount.value),
    }),
    vat: new FormGroup({
      kind: control(line.vat.kind),
      rate: control(line.vat.kind === 'taxed' ? line.vat.rate : ''),
      note: control(line.vat.kind === 'taxed' ? '' : line.vat.note),
    }),
  });
}

function metadataOf(quote: DraftQuote): QuoteMetadata {
  const {
    number,
    title,
    issueDate,
    validUntil,
    issuer,
    client,
    payment,
    conditions,
    lines,
    ...metadata
  } = quote;
  return structuredClone(metadata);
}

export function createQuoteForm(quote: DraftQuote = createBlankQuote()): QuoteForm {
  const form: QuoteForm = new FormGroup({
    metadata: control(metadataOf(quote)),
    number: control(quote.number),
    title: control(quote.title),
    issueDate: control(quote.issueDate),
    validUntil: control(quote.validUntil),
    issuer: createPartyForm(quote.issuer),
    client: createPartyForm(quote.client),
    payment: new FormGroup({
      method: control(quote.payment.method),
      holder: control(quote.payment.holder),
      instructions: control(quote.payment.instructions),
      iban: control(quote.payment.iban),
    }),
    conditions: new FormGroup({
      terms: control(quote.conditions.terms),
      notes: control(quote.conditions.notes),
      includesFirstMonthlyPayment: control(quote.conditions.includesFirstMonthlyPayment),
    }),
    lines: new FormArray<QuoteLineForm>(quote.lines.map(createLineForm)),
  });
  // Adapta la validación del dominio a Angular; no replica reglas monetarias.
  form.addValidators(() => {
    const issues = validateQuoteForDocument(readQuoteForm(form));
    return issues.length > 0 ? { quoteIssues: issues } : null;
  });
  form.updateValueAndValidity({ emitEvent: false });
  return form;
}

/** Solo normaliza decimales simples; no interpreta separadores de miles ni exponentes. */
export function normalizeDecimalInput(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return trimmed;
  return trimmed.replace(',', '.').replace(/^0+(?=\d)/, '');
}

export function readLineForm(form: QuoteLineForm): QuoteLine {
  const value = form.getRawValue();
  return {
    id: value.id,
    ...(value.sourceServiceId ? { sourceServiceId: value.sourceServiceId } : {}),
    name: value.name,
    description: value.description,
    unit: value.unit,
    quantity: normalizeDecimalInput(value.quantity),
    unitPrice: normalizeDecimalInput(value.unitPrice),
    frequency: value.frequency,
    discount:
      value.discount.kind === 'none'
        ? { kind: 'none' }
        : { kind: value.discount.kind, value: normalizeDecimalInput(value.discount.value) },
    vat:
      value.vat.kind === 'taxed'
        ? { kind: 'taxed', rate: normalizeDecimalInput(value.vat.rate) }
        : { kind: value.vat.kind, note: value.vat.note },
  };
}

/** Proyección de solo lectura: el texto introducido permanece intacto en los controles. */
export function readQuoteForm(form: QuoteForm): DraftQuote {
  const { metadata, lines, ...value } = form.getRawValue();
  return {
    ...structuredClone(metadata),
    ...value,
    lines: form.controls.lines.controls.map(readLineForm),
  };
}

export function quoteFormIssues(form: QuoteForm): ValidationIssue[] {
  // Angular define ValidationErrors sin el tipo de sus valores; el adaptador anterior lo conoce.
  return (form.errors?.['quoteIssues'] as ValidationIssue[] | undefined) ?? [];
}

/** Sustituye el contenido sin reemplazar el FormGroup observado por el coordinador. */
export function replaceQuoteForm(form: QuoteForm, quote: DraftQuote, dirty = true): void {
  form.controls.lines.clear({ emitEvent: false });
  form.reset(
    {
      metadata: metadataOf(quote),
      number: quote.number,
      title: quote.title,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      issuer: quote.issuer,
      client: quote.client,
      payment: quote.payment,
      conditions: quote.conditions,
      lines: [],
    },
    { emitEvent: false },
  );
  form.controls.lines.push(quote.lines.map(createLineForm), { emitEvent: false });
  if (dirty) form.markAsDirty({ emitEvent: false });
  else form.markAsPristine({ emitEvent: false });
  form.updateValueAndValidity();
}
