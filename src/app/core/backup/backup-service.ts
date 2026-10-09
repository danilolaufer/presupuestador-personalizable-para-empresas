import { Inject, Injectable, InjectionToken } from '@angular/core';
import { AppDatabase, runDatabaseTransaction } from '../persistence/app-database';
import { copyQuote } from '../../domain/quotes/quote-lifecycle';
import type { Quote } from '../../domain/quotes/quote';
import { readStoredQuote } from '../../features/quotes/stored-quote';
import { readStoredSettings } from '../../features/settings/app-settings';
import {
  type BackupFile,
  type NumberCounter,
  parseBackup,
  validateRelations,
} from './backup-format';

export const BACKUP_IMAGE_CHECK = new InjectionToken<(url: string) => Promise<void>>(
  'BACKUP_IMAGE_CHECK',
  {
    providedIn: 'root',
    factory: () => async (url) => {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        const timer = setTimeout(
          () => finish(new Error('No se pudo comprobar el logo a tiempo.')),
          10000,
        );
        const finish = (error?: Error) => {
          clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          if (error) reject(error);
          else resolve();
        };
        image.onload = () =>
          image.naturalWidth &&
          image.naturalHeight &&
          image.naturalWidth * image.naturalHeight <= 16000000
            ? finish()
            : finish(new Error('El logo está vacío o supera los 16 megapíxeles.'));
        image.onerror = () =>
          finish(new Error('Un logo no se puede decodificar. La copia no se ha importado.'));
        image.src = url;
      });
    },
  },
);

export type ImportChoice = 'restore' | 'skip' | 'copy';
export interface ImportRow {
  quote: Quote;
  reason: string;
  choice: ImportChoice;
}
export interface ImportReview {
  backup: BackupFile;
  baseline: string;
  existing: Quote[];
  rows: ImportRow[];
}
interface Snapshot {
  quotes: Quote[];
  settings: unknown[];
}
const numberKey = (number: string) => number.trim().toUpperCase();
const fingerprint = (snapshot: Snapshot) => JSON.stringify(snapshot);
const contentKey = ({ revision, updatedAt, ...quote }: Quote) => JSON.stringify(quote);

function readSnapshot(
  transaction: IDBTransaction,
  complete: (snapshot: Snapshot) => void,
  abort: (error: unknown) => void,
): void {
  const quotes = transaction.objectStore('quotes').getAll();
  const settings = transaction.objectStore('settings').getAll();
  let remaining = 2;
  const ready = () => {
    if (--remaining) return;
    try {
      complete({ quotes: quotes.result.map(readStoredQuote), settings: settings.result });
    } catch (error) {
      abort(error);
    }
  };
  quotes.onsuccess = ready;
  settings.onsuccess = ready;
}
function countersFrom(records: unknown[]): NumberCounter[] {
  return records.filter(
    (record): record is NumberCounter =>
      typeof (record as NumberCounter).id === 'string' &&
      (record as NumberCounter).id.startsWith('quote-sequence-'),
  );
}

/** Calcula impedimentos sin modificar documentos. Se repite dentro del bloqueo de escritura. */
export function importReasons(
  backup: BackupFile,
  existing: Quote[],
  choices: Record<string, ImportChoice>,
): Map<string, string> {
  const reasons = new Map<string, string>();
  const existingById = new Map(existing.map((quote) => [quote.id, quote]));
  const incomingById = new Map(backup.quotes.map((quote) => [quote.id, quote]));
  const numbers = new Set(existing.map((quote) => numberKey(quote.number)).filter(Boolean));
  for (const quote of backup.quotes) {
    if (existingById.has(quote.id)) reasons.set(quote.id, 'El ID ya existe.');
    if (numberKey(quote.number) && numbers.has(numberKey(quote.number)))
      reasons.set(quote.id, 'El número ya existe o se repite en la copia.');
    if (choices[quote.id] === 'restore' && !reasons.has(quote.id) && numberKey(quote.number))
      numbers.add(numberKey(quote.number));
  }
  // Propaga dependencias hasta un punto fijo, incluso si el hijo aparece antes del padre.
  for (let pass = 0; pass <= backup.quotes.length; pass++) {
    let changed = false;
    for (const quote of backup.quotes) {
      if (!quote.revisionOfId || reasons.has(quote.id)) continue;
      const parent = incomingById.get(quote.revisionOfId);
      const storedParent = existingById.get(quote.revisionOfId);
      const restoredParent = parent && choices[parent.id] === 'restore' && !reasons.has(parent.id);
      const sameStoredParent =
        storedParent?.status !== 'draft' &&
        storedParent &&
        (!parent || contentKey(parent) === contentKey(storedParent));
      if (!restoredParent && !sameStoredParent) {
        reasons.set(
          quote.id,
          'No se puede conservar el enlace al documento de origen. Restaura su origen, omite este documento o recupéralo como borrador independiente.',
        );
        changed = true;
      }
    }
    if (!changed) break;
  }
  return reasons;
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  constructor(
    private readonly database: AppDatabase,
    @Inject(BACKUP_IMAGE_CHECK) private readonly checkImage: (url: string) => Promise<void>,
  ) {}

  private async snapshot(): Promise<Snapshot> {
    return runDatabaseTransaction(
      await this.database.open(),
      ['quotes', 'settings'],
      'readonly',
      (transaction, result, abort) => readSnapshot(transaction, result, abort),
    );
  }
  async export(): Promise<BackupFile> {
    const snapshot = await this.snapshot();
    const settings = snapshot.settings.find((record) => (record as { id: string }).id === 'app');
    return {
      kind: 'presupuestador-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      quotes: snapshot.quotes,
      settings: settings ? readStoredSettings(settings) : null,
      counters: countersFrom(snapshot.settings),
    };
  }
  async review(text: string): Promise<ImportReview> {
    const backup = parseBackup(text);
    await this.validateImages(backup);
    const snapshot = await this.snapshot();
    const choices = Object.fromEntries(
      backup.quotes.map((quote) => [quote.id, 'restore' as const]),
    );
    const reasons = importReasons(backup, snapshot.quotes, choices);
    return {
      backup,
      baseline: fingerprint(snapshot),
      existing: snapshot.quotes,
      rows: backup.quotes.map((quote) => ({
        quote,
        reason: reasons.get(quote.id) ?? '',
        choice: reasons.has(quote.id) ? 'skip' : 'restore',
      })),
    };
  }
  async restore(
    review: ImportReview,
    choices: Record<string, ImportChoice>,
    includeSettings: boolean,
  ): Promise<number> {
    // Copias antes del primer await: una modificación de la interfaz no altera esta operación.
    const backup = parseBackup(JSON.stringify(review.backup));
    const baseline = review.baseline;
    const selected = { ...choices };
    for (const quote of backup.quotes)
      if (!['restore', 'skip', 'copy'].includes(selected[quote.id]))
        throw new Error('Selecciona una resolución para cada presupuesto.');
    await this.validateImages(backup);
    return runDatabaseTransaction(
      await this.database.open(),
      ['quotes', 'settings'],
      'readwrite',
      (transaction, result, abort) => {
        readSnapshot(
          transaction,
          (snapshot) => {
            if (fingerprint(snapshot) !== baseline)
              throw new Error(
                'Los datos cambiaron desde la revisión, posiblemente en otra pestaña. Revisa de nuevo la copia antes de importar.',
              );
            const reasons = importReasons(backup, snapshot.quotes, selected);
            for (const quote of backup.quotes)
              if (selected[quote.id] === 'restore' && reasons.has(quote.id))
                throw new Error(reasons.get(quote.id));
            const counters = new Map<string, number>();
            for (const counter of [...countersFrom(snapshot.settings), ...backup.counters]) {
              if (!Number.isSafeInteger(counter.lastNumber) || counter.lastNumber < 0)
                throw new Error('Contador de numeración no válido.');
              counters.set(counter.id, Math.max(counters.get(counter.id) ?? 0, counter.lastNumber));
            }
            const originals = backup.quotes.filter((quote) => selected[quote.id] === 'restore');
            for (const quote of [...snapshot.quotes, ...originals]) {
              const match = /^P-(\d{4})-(\d+)$/.exec(numberKey(quote.number));
              if (match) {
                const number = Number(match[2]);
                if (!Number.isSafeInteger(number))
                  throw new Error('Un número de presupuesto supera el contador admitido.');
                const key = 'quote-sequence-' + match[1];
                counters.set(key, Math.max(counters.get(key) ?? 0, number));
              }
            }
            const copies = backup.quotes
              .filter((quote) => selected[quote.id] === 'copy')
              .map((quote) => {
                const copy = copyQuote(quote, 30);
                const year = new Date().getFullYear();
                const key = 'quote-sequence-' + year;
                const next = (counters.get(key) ?? 0) + 1;
                if (!Number.isSafeInteger(next))
                  throw new Error('Se ha agotado el contador de numeración.');
                counters.set(key, next);
                return {
                  ...copy,
                  revision: 1,
                  number: `P-${year}-${String(next).padStart(4, '0')}`,
                };
              });
            const restored = [...originals, ...copies];
            validateRelations([...snapshot.quotes, ...restored]);
            for (const quote of restored) transaction.objectStore('quotes').add(quote);
            const store = transaction.objectStore('settings');
            for (const [id, lastNumber] of counters) store.put({ id, lastNumber });
            if (includeSettings && backup.settings) {
              const old = snapshot.settings.find(
                (record) => (record as { id: string }).id === 'app',
              );
              const revision = old ? readStoredSettings(old).revision : 0;
              const nextRevision = Math.max(revision, backup.settings.revision) + 1;
              if (!Number.isSafeInteger(nextRevision))
                throw new Error('La revisión de configuración supera el límite admitido.');
              // Invalida formularios abiertos en otra pestaña, incluso si coinciden las revisiones importadas.
              store.put({
                ...backup.settings,
                revision: nextRevision,
                updatedAt: new Date().toISOString(),
              });
            }
            result(restored.length);
          },
          abort,
        );
      },
    );
  }
  private async validateImages(backup: BackupFile): Promise<void> {
    const logos = new Set(
      [
        ...backup.quotes.map((quote) => quote.brand.logoDataUrl),
        backup.settings?.brand.logoDataUrl,
      ].filter((url): url is string => !!url),
    );
    for (const logo of logos) await this.checkImage(logo);
  }
}
