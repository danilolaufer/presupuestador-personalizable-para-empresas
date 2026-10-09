import type Decimal from 'decimal.js';
import type { Quote, QuoteCalculationInput } from './quote';
import { QUOTE_LIMITS, QuoteDecimal } from './quote-decimal';

export interface ValidationIssue {
  code: 'required' | 'invalid-decimal' | 'out-of-range' | 'invalid-value' | 'duplicate-id';
  field: string;
  message: string;
  lineId?: string;
  lineIndex?: number;
}

interface DecimalRule {
  integerDigits: number;
  decimalPlaces: number;
  positive?: boolean;
  max?: string;
}

type AddIssue = (field: string, code: ValidationIssue['code'], message: string) => void;

function readDecimal(
  value: unknown,
  field: string,
  rule: DecimalRule,
  addIssue: AddIssue,
): Decimal | undefined {
  if (value === '') {
    addIssue(field, 'required', 'Completa este valor para calcular.');
    return undefined;
  }

  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    addIssue(
      field,
      'invalid-decimal',
      'Usa un decimal no negativo con punto, sin espacios ni símbolos.',
    );
    return undefined;
  }

  const [integerPart, fractionPart = ''] = value.split('.');
  if (integerPart.length > rule.integerDigits || fractionPart.length > rule.decimalPlaces) {
    addIssue(
      field,
      'out-of-range',
      `Admite hasta ${rule.integerDigits} cifras enteras y ${rule.decimalPlaces} decimales.`,
    );
    return undefined;
  }

  const decimal = new QuoteDecimal(value);
  if ((rule.positive && decimal.isZero()) || (rule.max && decimal.greaterThan(rule.max))) {
    addIssue(
      field,
      'out-of-range',
      rule.positive ? 'La cantidad debe ser mayor que cero.' : `El máximo es ${rule.max}.`,
    );
    return undefined;
  }
  return decimal;
}

/** Valida lo necesario para calcular un borrador, sin exigir su contenido documental. */
export function validateQuote(input: QuoteCalculationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (input.currency !== 'EUR') {
    issues.push({ field: 'currency', code: 'invalid-value', message: 'La moneda debe ser EUR.' });
  }
  if (input.lines.length === 0) {
    issues.push({ field: 'lines', code: 'required', message: 'Añade al menos un concepto.' });
  }
  if (input.lines.length > QUOTE_LIMITS.maxLines) {
    issues.push({
      field: 'lines',
      code: 'out-of-range',
      message: `El máximo es ${QUOTE_LIMITS.maxLines} conceptos.`,
    });
    return issues;
  }

  const lineIds = new Set<string>();
  input.lines.forEach((line, lineIndex) => {
    const addIssue: AddIssue = (field, code, message) => {
      issues.push({ field, code, message, lineId: line.id, lineIndex });
    };
    if (!line.id.trim()) {
      addIssue('id', 'required', 'El concepto necesita un identificador.');
    } else if (lineIds.has(line.id)) {
      addIssue('id', 'duplicate-id', 'Los identificadores de conceptos deben ser únicos.');
    }
    lineIds.add(line.id);

    if (line.frequency !== 'monthly' && line.frequency !== 'one-time') {
      addIssue('frequency', 'invalid-value', 'Elige pago único o cuota mensual.');
    }

    const quantity = readDecimal(
      line.quantity,
      'quantity',
      { ...QUOTE_LIMITS.quantity, positive: true },
      addIssue,
    );
    const unitPrice = readDecimal(line.unitPrice, 'unitPrice', QUOTE_LIMITS.unitPrice, addIssue);

    switch (line.discount.kind) {
      case 'none':
        break;
      case 'percentage':
        readDecimal(
          line.discount.value,
          'discount.value',
          { ...QUOTE_LIMITS.percentage, max: '100' },
          addIssue,
        );
        break;
      case 'fixed': {
        const discount = readDecimal(
          line.discount.value,
          'discount.value',
          QUOTE_LIMITS.fixedDiscount,
          addIssue,
        );
        if (quantity && unitPrice && discount) {
          // El límite es el bruto redondeado de toda la línea, no el precio unitario.
          const gross = quantity.times(unitPrice).toDecimalPlaces(2);
          if (discount.greaterThan(gross)) {
            addIssue(
              'discount.value',
              'out-of-range',
              'El descuento fijo no puede superar el bruto de la línea.',
            );
          }
        }
        break;
      }
      default:
        addIssue('discount.kind', 'invalid-value', 'Elige un tipo de descuento válido.');
    }

    switch (line.vat.kind) {
      case 'taxed':
        readDecimal(
          line.vat.rate,
          'vat.rate',
          { ...QUOTE_LIMITS.percentage, max: '100' },
          addIssue,
        );
        break;
      case 'exempt':
      case 'not-subject':
        break;
      default:
        addIssue('vat.kind', 'invalid-value', 'Elige un tratamiento de IVA válido.');
    }
  });

  return issues;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Completitud del documento; no valida importaciones ni consulta números en una base de datos. */
export function validateQuoteForDocument(quote: Quote): ValidationIssue[] {
  const issues = validateQuote(quote);
  const required = (field: string, value: string) => {
    if (!value.trim())
      issues.push({
        field,
        code: 'required',
        message: 'Completa este campo para finalizar el documento.',
      });
  };

  required('number', quote.number);
  for (const field of ['issueDate', 'validUntil'] as const) {
    if (quote[field] === '') {
      required(field, quote[field]);
    } else if (!isCalendarDate(quote[field])) {
      issues.push({
        field,
        code: 'invalid-value',
        message: 'Usa una fecha válida con formato YYYY-MM-DD.',
      });
    }
  }
  if (
    isCalendarDate(quote.issueDate) &&
    isCalendarDate(quote.validUntil) &&
    quote.validUntil < quote.issueDate
  ) {
    issues.push({
      field: 'validUntil',
      code: 'out-of-range',
      message: 'La validez no puede terminar antes de la emisión.',
    });
  }

  for (const party of ['issuer', 'client'] as const) {
    for (const field of ['name', 'taxId', 'address'] as const) {
      required(`${party}.${field}`, quote[party][field]);
    }
  }
  required('payment.method', quote.payment.method);
  required('payment.instructions', quote.payment.instructions);
  required('conditions.terms', quote.conditions.terms);

  quote.lines.forEach((line, lineIndex) => {
    const fields = [
      ['name', line.name],
      ['unit', line.unit],
    ];
    if (line.vat.kind !== 'taxed') fields.push(['vat.note', line.vat.note]);
    for (const [field, value] of fields) {
      if (!value.trim()) {
        issues.push({
          field,
          code: 'required',
          message: 'Completa este campo para finalizar el documento.',
          lineId: line.id,
          lineIndex,
        });
      }
    }
  });
  return issues;
}
