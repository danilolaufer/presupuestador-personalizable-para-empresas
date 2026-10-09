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
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import type { Quote, QuoteStatus } from '../../../domain/quotes/quote';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { formatQuoteMoney, QUOTE_STATUS_LABELS } from '../quote-presentation';

@Component({
  selector: 'app-quote-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './quote-list.html',
  styleUrl: './quote-list.scss',
})
export class QuoteList implements OnInit {
  private readonly repository = inject(QUOTE_REPOSITORY);
  private readonly settings = inject(SETTINGS_REPOSITORY);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly deleteDialog = viewChild.required<ElementRef<HTMLDialogElement>>('deleteDialog');
  readonly quotes = signal<Quote[]>([]);
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly error = signal('');
  readonly actionError = signal('');
  readonly busy = signal(false);
  readonly deleteTarget = signal<Quote | null>(null);
  readonly search = signal('');
  readonly status = signal('all');
  readonly order = signal('desc');
  readonly labels = QUOTE_STATUS_LABELS;
  readonly statuses: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected'];
  readonly formatMoney = formatQuoteMoney;
  private readonly rows = computed(() =>
    this.quotes().map((quote) => {
      const calculation = quote.status === 'draft' ? calculateQuote(quote) : null;
      return {
        quote,
        totals:
          quote.status !== 'draft'
            ? quote.totals
            : calculation?.status === 'valid'
              ? calculation.totals
              : null,
      };
    }),
  );
  readonly visibleRows = computed(() => {
    const term = this.search().trim().toLocaleLowerCase('es');
    return this.rows()
      .filter(
        ({ quote }) =>
          (this.status() === 'all' || quote.status === this.status()) &&
          [quote.number, quote.client.name, quote.title].some((value) =>
            value.toLocaleLowerCase('es').includes(term),
          ),
      )
      .sort(
        (a, b) =>
          (this.order() === 'desc' ? -1 : 1) *
            (Date.parse(a.quote.updatedAt) - Date.parse(b.quote.updatedAt)) ||
          a.quote.id.localeCompare(b.quote.id),
      );
  });
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.state.set('loading');
    this.error.set('');
    try {
      this.quotes.set(await this.repository.list());
      this.state.set('ready');
    } catch (error) {
      this.state.set('error');
      this.error.set(this.message(error));
    }
  }
  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
  async duplicate(quote: Quote): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set('');
    try {
      const settings = await this.settings.load();
      const copy = await this.repository.copy(
        quote.id,
        quote.revision,
        settings.validityDays,
        'duplicate',
      );
      this.quotes.update((items) => [...items, copy]);
      if (!this.destroyRef.destroyed)
        await this.router.navigate(['/presupuestos', copy.id, 'editar']);
    } catch (error) {
      this.actionError.set(this.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  askDelete(quote: Quote): void {
    if (this.busy()) return;
    this.deleteTarget.set(quote);
    this.actionError.set('');
    this.deleteDialog().nativeElement.showModal();
  }
  cancelDelete(): void {
    if (this.busy()) return;
    this.deleteDialog().nativeElement.close();
    this.deleteTarget.set(null);
  }
  async confirmDelete(): Promise<void> {
    const quote = this.deleteTarget();
    if (!quote || this.busy()) return;
    this.busy.set(true);
    this.actionError.set('');
    try {
      await this.repository.delete(quote.id, quote.revision);
      this.quotes.update((items) => items.filter((item) => item.id !== quote.id));
      this.deleteDialog().nativeElement.close();
      this.deleteTarget.set(null);
    } catch (error) {
      this.actionError.set(this.message(error));
    } finally {
      this.busy.set(false);
    }
  }
  private message(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'No se pudo completar la operación. Reintenta sin cerrar la aplicación.';
  }
}
