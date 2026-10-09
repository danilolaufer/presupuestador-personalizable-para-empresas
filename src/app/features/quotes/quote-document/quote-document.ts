import { Component, computed, input } from '@angular/core';
import type { Quote } from '../../../domain/quotes/quote';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import { validateQuoteForDocument } from '../../../domain/quotes/validate-quote';
import { validateStoredTotals } from '../../../domain/quotes/validate-totals';
import { formatQuoteMoney, QUOTE_STATUS_LABELS } from '../quote-presentation';

/** Un solo modelo de lectura para pantalla y papel. Nunca consulta configuración ni catálogo. */
export function documentView(quote: Quote) {
  const issues = validateQuoteForDocument(quote).map((issue) => {
    const names: Record<string, string> = {
      number: 'Número',
      issueDate: 'Fecha de emisión',
      validUntil: 'Validez',
      'issuer.name': 'Nombre del emisor',
      'issuer.taxId': 'Identificación fiscal del emisor',
      'issuer.address': 'Dirección del emisor',
      'client.name': 'Nombre del cliente',
      'client.taxId': 'Identificación fiscal del cliente',
      'client.address': 'Dirección del cliente',
      'payment.method': 'Forma de pago',
      'payment.instructions': 'Instrucciones de pago',
      'conditions.terms': 'Condiciones',
      lines: 'Servicios',
      name: 'Nombre',
      unit: 'Unidad',
      quantity: 'Cantidad',
      unitPrice: 'Precio',
      'discount.value': 'Descuento',
      'vat.rate': 'IVA',
      'vat.note': 'Motivo fiscal',
    };
    return `${issue.lineIndex === undefined ? '' : `Servicio ${issue.lineIndex + 1}, `}${names[issue.field] ?? issue.field}: ${issue.message}`;
  });
  if (quote.status !== 'draft') {
    try {
      validateStoredTotals(quote.totals, quote);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : 'Importes conservados incompatibles.');
      return { totals: null, issues };
    }
    return { totals: quote.totals, issues };
  }
  const calculation = calculateQuote(quote);
  return { totals: calculation.status === 'valid' ? calculation.totals : null, issues };
}

@Component({
  selector: 'app-quote-document',
  templateUrl: './quote-document.html',
  styleUrl: './quote-document.scss',
})
export class QuoteDocument {
  readonly quote = input.required<Quote>();
  readonly view = computed(() => documentView(this.quote()));
  readonly money = formatQuoteMoney;
  readonly labels = QUOTE_STATUS_LABELS;
  readonly groups = computed(() => {
    const totals = this.view().totals;
    return totals
      ? [
          { title: 'Pago único', amounts: totals.oneTime },
          { title: 'Cuota mensual', amounts: totals.monthly },
        ]
      : [];
  });
  date(value: string): string {
    return value ? value.split('-').reverse().join('/') : 'Pendiente';
  }
}
