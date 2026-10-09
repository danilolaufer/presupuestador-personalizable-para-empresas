import type { Quote } from '../../domain/quotes/quote';
import { QuoteRepositoryError } from './quote-repository';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown, fields: string[]): value is Record<string, unknown> {
  return record(value) && fields.every((field) => typeof value[field] === 'string');
}

/** Comprobación estructural de lectura. Los borradores admiten strings vacíos o inválidos. */
export function readStoredQuote(value: unknown): Quote {
  const invalid = () =>
    new QuoteRepositoryError(
      'unsupported-document',
      'El documento tiene una versión o estructura no compatible. Se conserva sin modificar.',
    );
  if (
    !strings(value, [
      'id',
      'number',
      'title',
      'issueDate',
      'validUntil',
      'createdAt',
      'updatedAt',
    ]) ||
    value['id'] === '' ||
    (value['revisionOfId'] !== undefined && typeof value['revisionOfId'] !== 'string') ||
    value['schemaVersion'] !== 2 ||
    value['calculationVersion'] !== 1 ||
    value['currency'] !== 'EUR' ||
    !Number.isSafeInteger(value['revision']) ||
    (value['revision'] as number) < 1 ||
    !['draft', 'sent', 'accepted', 'rejected'].includes(String(value['status'])) ||
    !strings(value['issuer'], ['name', 'taxId', 'address', 'email', 'phone']) ||
    !strings(value['client'], ['name', 'taxId', 'address', 'email', 'phone']) ||
    !strings(value['payment'], ['method', 'holder', 'instructions', 'iban']) ||
    !strings(value['conditions'], ['terms', 'notes']) ||
    typeof value['conditions']['includesFirstMonthlyPayment'] !== 'boolean' ||
    !strings(value['brand'], ['name', 'accentColor']) ||
    (value['brand']['logoDataUrl'] !== null && typeof value['brand']['logoDataUrl'] !== 'string') ||
    !Array.isArray(value['lines']) ||
    (value['status'] !== 'draft' && !record(value['totals']))
  )
    throw invalid();

  for (const line of value['lines']) {
    if (
      !strings(line, ['id', 'name', 'description', 'unit', 'quantity', 'unitPrice']) ||
      line['id'] === '' ||
      (line['sourceServiceId'] !== undefined && typeof line['sourceServiceId'] !== 'string') ||
      !['monthly', 'one-time'].includes(String(line['frequency'])) ||
      !record(line['discount']) ||
      !record(line['vat'])
    )
      throw invalid();
    const discount = line['discount'];
    const vat = line['vat'];
    if (
      !(
        discount['kind'] === 'none' ||
        (['percentage', 'fixed'].includes(String(discount['kind'])) &&
          typeof discount['value'] === 'string')
      ) ||
      !(
        (vat['kind'] === 'taxed' && typeof vat['rate'] === 'string') ||
        (['exempt', 'not-subject'].includes(String(vat['kind'])) && typeof vat['note'] === 'string')
      )
    )
      throw invalid();
  }
  return value as unknown as Quote;
}
