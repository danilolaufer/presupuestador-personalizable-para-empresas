import type { Quote } from '../../domain/quotes/quote';
import { validateStoredTotals } from '../../domain/quotes/validate-totals';
import { validateQuoteForDocument } from '../../domain/quotes/validate-quote';
import { readStoredQuote } from '../../features/quotes/stored-quote';
import { readStoredSettings, type AppSettings } from '../../features/settings/app-settings';
import { isValidLogoDataUrl } from '../../features/settings/logo-file';
import { migrateQuoteV1 } from '../persistence/migrate-quote';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export interface NumberCounter {
  id: string;
  lastNumber: number;
}
export interface BackupFile {
  kind: 'presupuestador-backup';
  schemaVersion: 1;
  exportedAt: string;
  quotes: Quote[];
  settings: AppSettings | null;
  counters: NumberCounter[];
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function id(value: unknown): void {
  check(
    typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value),
    'Identificador inválido.',
  );
}
function timestamp(value: unknown): void {
  check(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
      Number.isFinite(Date.parse(value)),
    'Fecha de registro inválida.',
  );
}
/** Acota memoria, profundidad y textos antes de recorrer estructuras no fiables. */
function checkTree(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  check(depth <= 16 && ++budget.nodes <= 1000000, 'La copia supera los límites de estructura.');
  if (typeof value === 'string')
    check(
      value.length <= (value.startsWith('data:image/') ? 410000 : 200000),
      'Un texto o imagen supera el tamaño permitido.',
    );
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      check(
        !['__proto__', 'constructor', 'prototype'].includes(key),
        'La copia contiene una propiedad no admitida.',
      );
      checkTree(child, depth + 1, budget);
    }
  }
}
function decimal(value: unknown, incomplete: boolean): void {
  check(
    typeof value === 'string' &&
      value.length <= 64 &&
      (incomplete ? /^-?\d*(?:[.,]\d*)?$/.test(value) : /^(0|[1-9]\d*)(\.\d+)?$/.test(value)),
    'Un decimal no es texto numérico admitido. Los borradores permiten vacíos y decimales a medio escribir.',
  );
}
function brand(value: Quote['brand']): void {
  check(/^#[\da-f]{6}$/i.test(value.accentColor), 'Color de marca inválido.');
  check(
    value.logoDataUrl === null || isValidLogoDataUrl(value.logoDataUrl),
    'Logo inválido: usa PNG, JPEG o WebP de hasta 300 KiB.',
  );
}

export function validateBackupQuote(value: unknown, emergency = false): Quote {
  if (emergency) value = migrateQuoteV1(value);
  check(record(value), 'El presupuesto no es un objeto.');
  // El JSON de emergencia puede proceder de una creación fallida (revisión técnica 0).
  if (emergency && value['revision'] === 0 && value['status'] === 'draft')
    value = { ...value, revision: 1 };
  const quote = structuredClone(readStoredQuote(value));
  id(quote.id);
  if (quote.revisionOfId !== undefined) id(quote.revisionOfId);
  check(typeof quote.status === 'string', 'Estado inválido.');
  check(quote.revision < Number.MAX_SAFE_INTEGER, 'La revisión técnica supera el límite admitido.');
  for (const date of [quote.issueDate, quote.validUntil]) {
    check(
      (quote.status === 'draft' && date === '') ||
        (/^\d{4}-\d{2}-\d{2}$/.test(date) &&
          Number.isFinite(Date.parse(date)) &&
          new Date(date).toISOString().slice(0, 10) === date),
      'Fecha del presupuesto inválida.',
    );
  }
  timestamp(quote.createdAt);
  timestamp(quote.updatedAt);
  brand(quote.brand);
  check(quote.lines.length <= 1000, 'Un presupuesto supera las 1000 líneas.');
  const ids = new Set<string>();
  quote.lines.forEach((line) => {
    id(line.id);
    check(!ids.has(line.id), 'Hay identificadores de líneas repetidos.');
    ids.add(line.id);
    if (line.sourceServiceId !== undefined) id(line.sourceServiceId);
    check(
      typeof line.frequency === 'string' &&
        typeof line.discount.kind === 'string' &&
        typeof line.vat.kind === 'string',
      'Periodicidad, descuento o IVA inválidos.',
    );
    decimal(line.quantity, quote.status === 'draft');
    decimal(line.unitPrice, quote.status === 'draft');
    if (line.discount.kind !== 'none') decimal(line.discount.value, quote.status === 'draft');
    if (line.vat.kind === 'taxed') decimal(line.vat.rate, quote.status === 'draft');
  });
  if (quote.status !== 'draft') {
    check(
      validateQuoteForDocument(quote).length === 0,
      'Un documento emitido contiene campos incompletos o inválidos.',
    );
    validateStoredTotals(quote.totals, quote);
  } else check(!('totals' in quote), 'Un borrador no puede contener importes cerrados.');
  return quote;
}

export function validateRelations(quotes: Quote[]): void {
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  check(byId.size === quotes.length, 'La copia contiene presupuestos con ID repetido.');
  for (const quote of quotes) {
    const visited = new Set([quote.id]);
    let parentId = quote.revisionOfId;
    while (parentId) {
      check(!visited.has(parentId), 'Las relaciones entre revisiones contienen un ciclo.');
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break; // El origen puede estar en la base de destino: se resuelve antes de escribir.
      check(parent.status !== 'draft', 'Una revisión debe proceder de un documento emitido.');
      parentId = parent.revisionOfId;
    }
  }
}

export function parseBackup(text: string): BackupFile {
  check(
    new TextEncoder().encode(text).byteLength <= MAX_BACKUP_BYTES,
    'La copia supera los 50 MiB.',
  );
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  checkTree(input);
  check(record(input) && input['schemaVersion'] === 1, 'Versión de copia incompatible.');
  timestamp(input['exportedAt']);
  if (input['kind'] === 'presupuestador-emergency') {
    const quote = validateBackupQuote(input['quote'], true);
    check(quote.status === 'draft', 'La copia de emergencia debe contener un borrador.');
    validateRelations([quote]);
    return {
      kind: 'presupuestador-backup',
      schemaVersion: 1,
      exportedAt: input['exportedAt'] as string,
      quotes: [quote],
      settings: null,
      counters: [],
    };
  }
  check(
    input['kind'] === 'presupuestador-backup' &&
      Array.isArray(input['quotes']) &&
      input['quotes'].length <= 10000 &&
      Array.isArray(input['counters']) &&
      input['counters'].length <= 10000,
    'Estructura de copia incompatible (máximo 10 000 presupuestos).',
  );
  const quotes = input['quotes'].map((value) => validateBackupQuote(value));
  validateRelations(quotes);
  const settings = input['settings'] === null ? null : readStoredSettings(input['settings']);
  if (settings) {
    timestamp(settings.updatedAt);
    brand(settings.brand);
    settings.catalog.forEach((item) => id(item.id));
  }
  const counterIds = new Set<string>();
  const counters = input['counters'].map((value) => {
    check(
      record(value) &&
        typeof value['id'] === 'string' &&
        /^quote-sequence-\d{4}$/.test(value['id']) &&
        Number.isSafeInteger(value['lastNumber']) &&
        (value['lastNumber'] as number) >= 0 &&
        !counterIds.has(value['id']),
      'Contador de numeración inválido o duplicado.',
    );
    counterIds.add(value['id']);
    return { id: value['id'], lastNumber: value['lastNumber'] as number };
  });
  return {
    kind: 'presupuestador-backup',
    schemaVersion: 1,
    exportedAt: input['exportedAt'] as string,
    quotes,
    settings,
    counters,
  };
}
