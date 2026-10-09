import { Injectable } from '@angular/core';
import {
  AppDatabase,
  runDatabaseTransaction,
  runTransaction,
} from '../../core/persistence/app-database';
import type { DraftQuote, FinalizedQuote, Quote } from '../../domain/quotes/quote';
import { changeQuoteStatus, copyQuote } from '../../domain/quotes/quote-lifecycle';
import { QuoteRepositoryError, type QuoteRepository } from './quote-repository';
import { readStoredQuote } from './stored-quote';

const numberKey = (number: string) => number.trim().toUpperCase();

@Injectable()
export class IndexedDbQuoteRepository implements QuoteRepository {
  constructor(private readonly database: AppDatabase) {}

  async list(): Promise<Quote[]> {
    return runTransaction(
      await this.database.open(),
      'quotes',
      'readonly',
      (store, result, abort) => {
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            result(request.result.map(readStoredQuote));
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  async findById(id: string): Promise<Quote | null> {
    return runTransaction(
      await this.database.open(),
      'quotes',
      'readonly',
      (store, result, abort) => {
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            result(request.result === undefined ? null : readStoredQuote(request.result));
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  async create(quote: DraftQuote): Promise<DraftQuote> {
    const snapshot = structuredClone(quote);
    return this.createWithNumber(() => snapshot);
  }

  async copy(
    id: string,
    expectedRevision: number,
    validityDays: number,
    kind: 'duplicate' | 'revision',
  ): Promise<DraftQuote> {
    return this.createWithNumber((documents) => {
      const source = this.checkRevision(
        documents.find((item) => item.id === id),
        expectedRevision,
      );
      if (kind !== 'duplicate' && kind !== 'revision')
        throw new QuoteRepositoryError('invalid-document', 'Acción de copia no válida.');
      return copyQuote(source, validityDays, kind === 'revision');
    });
  }

  /** El contador y el documento se confirman juntos. El lock incluye quotes y settings. */
  private async createWithNumber(make: (documents: Quote[]) => DraftQuote): Promise<DraftQuote> {
    return runDatabaseTransaction(
      await this.database.open(),
      ['quotes', 'settings'],
      'readwrite',
      (transaction, result, abort) => {
        const store = transaction.objectStore('quotes');
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const documents = request.result.map(readStoredQuote);
            const quote = make(documents);
            if (quote.status !== 'draft')
              throw new QuoteRepositoryError(
                'read-only',
                'Los documentos nuevos deben empezar como borradores.',
              );
            if (documents.some((item) => item.id === quote.id))
              throw new QuoteRepositoryError(
                'conflict',
                'Ya existe un presupuesto con este identificador.',
              );
            const save = (number: string) => {
              const saved: DraftQuote = {
                ...quote,
                number,
                revision: 1,
                updatedAt: new Date().toISOString(),
              };
              readStoredQuote(saved);
              this.assertUniqueNumber(saved, documents);
              store.add(saved);
              result(saved);
            };
            if (quote.number.trim()) {
              save(quote.number);
              return;
            }
            const year = new Date().getFullYear();
            const key = 'quote-sequence-' + year;
            const settings = transaction.objectStore('settings');
            const counter = settings.get(key);
            counter.onsuccess = () => {
              try {
                let last = counter.result === undefined ? 0 : counter.result.lastNumber;
                if (!Number.isSafeInteger(last) || last < 0)
                  throw new Error(
                    'El contador de numeración no es válido. Se conserva sin modificar.',
                  );
                for (const document of documents) {
                  const match = new RegExp('^P-' + year + '-(\\d+)$').exec(
                    numberKey(document.number),
                  );
                  if (match && Number.isSafeInteger(Number(match[1])))
                    last = Math.max(last, Number(match[1]));
                }
                if (!Number.isSafeInteger(last + 1))
                  throw new Error('Se ha agotado el contador de numeración.');
                const next = last + 1;
                save('P-' + year + '-' + String(next).padStart(4, '0'));
                settings.put({ id: key, lastNumber: next });
              } catch (error) {
                abort(error);
              }
            };
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  async save(quote: DraftQuote, expectedRevision: number): Promise<DraftQuote> {
    const snapshot = structuredClone(quote);
    return runTransaction(
      await this.database.open(),
      'quotes',
      'readwrite',
      (store, result, abort) => {
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const documents = request.result.map(readStoredQuote);
            const current = this.checkRevision(
              documents.find((item) => item.id === snapshot.id),
              expectedRevision,
            );
            if (current.status !== 'draft' || snapshot.status !== 'draft')
              throw new QuoteRepositoryError(
                'read-only',
                'Este contenido solo puede modificarse creando una revisión.',
              );
            const saved: DraftQuote = {
              ...snapshot,
              createdAt: current.createdAt,
              revision: current.revision + 1,
              updatedAt: new Date().toISOString(),
            };
            readStoredQuote(saved);
            // Los duplicados heredados no bloquean otros campos; cambiar el número sí exige unicidad.
            if (numberKey(saved.number) !== numberKey(current.number))
              this.assertUniqueNumber(saved, documents);
            store.put(saved);
            result(saved);
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  async changeStatus(
    id: string,
    expectedRevision: number,
    status: FinalizedQuote['status'],
  ): Promise<FinalizedQuote> {
    return runTransaction(
      await this.database.open(),
      'quotes',
      'readwrite',
      (store, result, abort) => {
        const request = store.getAll();
        request.onsuccess = () => {
          try {
            const documents = request.result.map(readStoredQuote);
            const current = this.checkRevision(
              documents.find((item) => item.id === id),
              expectedRevision,
            );
            this.assertUniqueNumber(current, documents);
            let changed: FinalizedQuote;
            try {
              changed = changeQuoteStatus(current, status);
            } catch (error) {
              throw new QuoteRepositoryError(
                'invalid-document',
                error instanceof Error ? error.message : 'El documento no se puede cerrar.',
              );
            }
            const saved = {
              ...changed,
              revision: current.revision + 1,
              updatedAt: new Date().toISOString(),
            };
            readStoredQuote(saved);
            store.put(saved);
            result(saved);
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  async delete(id: string, expectedRevision: number): Promise<void> {
    return runTransaction(
      await this.database.open(),
      'quotes',
      'readwrite',
      (store, result, abort) => {
        const request = store.get(id);
        request.onsuccess = () => {
          try {
            this.checkRevision(request.result, expectedRevision);
            store.delete(id);
            result(undefined);
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }

  private assertUniqueNumber(quote: Quote, documents: Quote[]): void {
    const key = numberKey(quote.number);
    if (key && documents.some((item) => item.id !== quote.id && numberKey(item.number) === key))
      throw new QuoteRepositoryError(
        'duplicate-number',
        'El número «' +
          quote.number.trim() +
          '» ya pertenece a otro presupuesto. Cámbialo y reintenta guardar.',
      );
  }

  private checkRevision(value: unknown, expected: number): Quote {
    if (value === undefined)
      throw new QuoteRepositoryError('not-found', 'El presupuesto ya no existe.');
    const current = readStoredQuote(value);
    if (current.revision !== expected)
      throw new QuoteRepositoryError('conflict', 'Otra pestaña ha modificado este presupuesto.');
    return current;
  }
}
