import { InjectionToken } from '@angular/core';
import type { DraftQuote, FinalizedQuote, Quote } from '../../domain/quotes/quote';

export interface QuoteRepository {
  list(): Promise<Quote[]>;
  findById(id: string): Promise<Quote | null>;
  create(quote: DraftQuote): Promise<DraftQuote>;
  save(quote: DraftQuote, expectedRevision: number): Promise<DraftQuote>;
  delete(id: string, expectedRevision: number): Promise<void>;
  copy(
    id: string,
    expectedRevision: number,
    validityDays: number,
    kind: 'duplicate' | 'revision',
  ): Promise<DraftQuote>;
  changeStatus(
    id: string,
    expectedRevision: number,
    status: FinalizedQuote['status'],
  ): Promise<FinalizedQuote>;
}

export const QUOTE_REPOSITORY = new InjectionToken<QuoteRepository>('QUOTE_REPOSITORY');

export class QuoteRepositoryError extends Error {
  constructor(
    readonly code:
      | 'conflict'
      | 'not-found'
      | 'read-only'
      | 'unsupported-document'
      | 'duplicate-number'
      | 'invalid-document',
    message: string,
  ) {
    super(message);
    this.name = 'QuoteRepositoryError';
  }
}
