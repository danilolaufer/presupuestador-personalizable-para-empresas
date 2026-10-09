import { DOCUMENT } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Quote } from '../../../domain/quotes/quote';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { QuoteDocument, documentView } from '../quote-document/quote-document';
import { prepareDocumentPrint } from '../quote-document/print-document';

@Component({
  selector: 'app-quote-preview',
  imports: [RouterLink, QuoteDocument],
  templateUrl: './quote-preview.html',
  styleUrl: './quote-preview.scss',
})
export class QuotePreview implements OnInit {
  private readonly repository = inject(QUOTE_REPOSITORY);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly paper = viewChild<QuoteDocument, ElementRef<HTMLElement>>('paper', {
    read: ElementRef,
  });
  readonly quote = signal<Quote | null>(null);
  readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  readonly error = signal('');
  readonly printing = signal(false);
  readonly issues = computed(() => {
    const quote = this.quote();
    return quote ? documentView(quote).issues : [];
  });
  private sequence = 0;
  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => void this.load());
  }
  async load(): Promise<void> {
    const sequence = ++this.sequence;
    this.state.set('loading');
    this.error.set('');
    this.quote.set(null);
    try {
      const quote = await this.repository.findById(this.route.snapshot.paramMap.get('id')!);
      if (sequence !== this.sequence || this.destroyRef.destroyed) return;
      this.quote.set(quote);
      this.state.set(quote ? 'ready' : 'missing');
    } catch (error) {
      if (sequence !== this.sequence || this.destroyRef.destroyed) return;
      this.state.set('error');
      this.error.set(this.message(error));
    }
  }
  async print(): Promise<void> {
    const element = this.paper()?.nativeElement;
    const sequence = this.sequence;
    if (!element || this.printing() || this.issues().length || this.state() !== 'ready') return;
    this.printing.set(true);
    this.error.set('');
    try {
      await prepareDocumentPrint(element, this.document);
      if (!this.destroyRef.destroyed && sequence === this.sequence)
        this.document.defaultView?.print();
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.printing.set(false);
    }
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'No se pudo preparar el documento. Reintenta.';
  }
}
