import type { DraftQuote, FinalizedQuote, Quote } from '../../../domain/quotes/quote';
import { changeQuoteStatus, copyQuote } from '../../../domain/quotes/quote-lifecycle';
import { QuoteRepositoryError, type QuoteRepository } from '../quote-repository';

/** Doble de contrato para controlar retrasos y fallos del coordinador en las pruebas. */
export class MemoryQuoteRepository implements QuoteRepository {
  readonly documents = new Map<string, Quote>();
  private sequence = 0;
  async list(): Promise<Quote[]> {
    return structuredClone([...this.documents.values()]);
  }
  async findById(id: string): Promise<Quote | null> {
    return structuredClone(this.documents.get(id) ?? null);
  }
  async create(quote: DraftQuote): Promise<DraftQuote> {
    if (this.documents.has(quote.id)) throw new QuoteRepositoryError('conflict', 'Ya existe.');
    const number =
      quote.number || `P-${new Date().getFullYear()}-${String(++this.sequence).padStart(4, '0')}`;
    const saved = {
      ...structuredClone(quote),
      number,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(saved.id, saved);
    return structuredClone(saved);
  }
  async save(quote: DraftQuote, expected: number): Promise<DraftQuote> {
    const current = this.documents.get(quote.id);
    if (!current) throw new QuoteRepositoryError('not-found', 'No existe.');
    if (current.revision !== expected)
      throw new QuoteRepositoryError('conflict', 'Otra pestaña ha guardado cambios.');
    if (current.status !== 'draft')
      throw new QuoteRepositoryError('read-only', 'El contenido está cerrado.');
    const saved = {
      ...structuredClone(quote),
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(saved.id, saved);
    return structuredClone(saved);
  }
  async delete(id: string, expected: number): Promise<void> {
    if (this.documents.get(id)?.revision !== expected)
      throw new QuoteRepositoryError('conflict', 'Revisión distinta.');
    this.documents.delete(id);
  }
  async copy(
    id: string,
    expected: number,
    validityDays: number,
    kind: 'duplicate' | 'revision',
  ): Promise<DraftQuote> {
    const quote = this.documents.get(id);
    if (!quote || quote.revision !== expected)
      throw new QuoteRepositoryError('conflict', 'Revisión distinta.');
    return this.create(copyQuote(quote, validityDays, kind === 'revision'));
  }
  async changeStatus(
    id: string,
    expected: number,
    status: FinalizedQuote['status'],
  ): Promise<FinalizedQuote> {
    const quote = this.documents.get(id);
    if (!quote || quote.revision !== expected)
      throw new QuoteRepositoryError('conflict', 'Revisión distinta.');
    const saved = {
      ...changeQuoteStatus(quote, status),
      revision: expected + 1,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(id, saved);
    return structuredClone(saved);
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
