import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import type { FinalizedQuote } from '../../../domain/quotes/quote';
import { formatQuoteMoney, QUOTE_STATUS_LABELS } from '../quote-presentation';

@Component({
  selector: 'app-quote-record',
  imports: [RouterLink, DatePipe],
  templateUrl: './quote-record.html',
  styleUrl: './quote-record.scss',
})
export class QuoteRecord {
  readonly quote = input.required<FinalizedQuote>();
  readonly busy = input(false);
  readonly error = input('');
  readonly changeState = output<FinalizedQuote['status']>();
  readonly createRevision = output<void>();
  readonly reload = output<void>();
  readonly labels = QUOTE_STATUS_LABELS;
  readonly states: FinalizedQuote['status'][] = ['sent', 'accepted', 'rejected'];
  readonly formatMoney = formatQuoteMoney;
}
