import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import type { DraftQuote } from '../../domain/quotes/quote';

export function serializeEmergencyQuote(quote: DraftQuote): string {
  return JSON.stringify(
    {
      kind: 'presupuestador-emergency',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      quote,
    },
    null,
    2,
  );
}

@Injectable({ providedIn: 'root' })
export class EmergencyQuoteBackup {
  private readonly document = inject(DOCUMENT);

  download(quote: DraftQuote): void {
    const blob = new Blob([serializeEmergencyQuote(quote)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = `presupuesto-${quote.id}.json`;
    try {
      this.document.body.append(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}
