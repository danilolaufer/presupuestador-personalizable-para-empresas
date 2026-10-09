import { calculateQuote } from './calculate-quote';
import type { DraftQuote, FinalizedQuote, Quote } from './quote';
import { validateQuoteForDocument } from './validate-quote';

export function civilDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function quoteDates(validityDays: number, now = new Date()) {
  if (!Number.isInteger(validityDays) || validityDays < 0 || validityDays > 3650)
    throw new Error('El plazo de validez debe estar entre 0 y 3650 días.');
  const until = new Date(now);
  until.setDate(until.getDate() + validityDays);
  return { issueDate: civilDate(now), validUntil: civilDate(until) };
}

/** Copia el histórico, nunca consulta precios o datos de empresa actuales. */
export function copyQuote(source: Quote, validityDays: number, asRevision = false): DraftQuote {
  if (asRevision && source.status === 'draft')
    throw new Error('Solo se revisan documentos cerrados.');
  const { status, revisionOfId, ...content } = structuredClone(source);
  // Los totales cerrados no pertenecen a un borrador nuevo.
  const copy = content as Omit<Quote, 'status'> & { totals?: unknown };
  delete copy.totals;
  const now = new Date();
  return {
    ...copy,
    id: crypto.randomUUID(),
    number: '',
    status: 'draft',
    ...quoteDates(validityDays, now),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 0,
    schemaVersion: 2,
    ...(asRevision ? { revisionOfId: source.id } : {}),
    lines: source.lines.map((line) => ({ ...structuredClone(line), id: crypto.randomUUID() })),
  };
}

export function changeQuoteStatus(quote: Quote, status: FinalizedQuote['status']): FinalizedQuote {
  if (!['sent', 'accepted', 'rejected'].includes(status))
    throw new Error('El contenido cerrado solo puede modificarse creando una revisión.');
  if (quote.status !== 'draft') return { ...structuredClone(quote), status };
  if (status !== 'sent') throw new Error('Primero hay que marcar el borrador como enviado.');
  const issues = validateQuoteForDocument(quote);
  if (issues.length)
    throw new Error('Completa los campos del documento antes de marcarlo como enviado.');
  const calculation = calculateQuote(quote);
  if (calculation.status !== 'valid')
    throw new Error('No se pueden cerrar importes incompletos o inválidos.');
  return { ...structuredClone(quote), status, calculationVersion: 1, totals: calculation.totals };
}
