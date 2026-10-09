import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import { QUOTE_LIMITS } from '../../../domain/quotes/quote-decimal';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import type { DraftQuote, FinalizedQuote } from '../../../domain/quotes/quote';
import { quoteDates } from '../../../domain/quotes/quote-lifecycle';
import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { templateLine, type ServiceTemplate } from '../../settings/app-settings';
import { QUOTE_REPOSITORY, QuoteRepositoryError } from '../quote-repository';
import {
  createLineForm,
  createQuoteForm,
  quoteFormIssues,
  readQuoteForm,
  replaceQuoteForm,
} from './quote-form';

@Injectable()
export class QuoteEditorStore {
  private readonly repository = inject(QUOTE_REPOSITORY);
  private readonly settingsRepository = inject(SETTINGS_REPOSITORY);
  private readonly destroyRef = inject(DestroyRef);
  readonly form = createQuoteForm();
  readonly maxLines = QUOTE_LIMITS.maxLines;
  readonly loadState = signal<'loading' | 'ready' | 'not-found' | 'load-error' | 'read-only'>(
    'loading',
  );
  readonly saveState = signal<'unsaved' | 'saving' | 'saved' | 'error' | 'conflict'>('unsaved');
  readonly savedAt = signal<string | null>(null);
  readonly loadError = signal('');
  readonly saveError = signal('');
  readonly hasPendingChanges = signal(false);
  readonly reloading = signal(false);
  readonly closedQuote = signal<FinalizedQuote | null>(null);
  readonly commercialBusy = signal(false);
  readonly commercialError = signal('');
  private readonly closingContent = signal(false);
  readonly catalog = signal<readonly ServiceTemplate[]>([]);
  readonly catalogError = signal('');
  readonly catalogLoading = signal(false);
  readonly numberError = signal('');
  private suggestedVatRate = '21';
  private defaultsApplied = false;
  readonly canEdit = computed(
    () => this.loadState() === 'ready' && !this.reloading() && !this.closingContent(),
  );

  private autoSaveEnabled = false;
  private suppressChanges = false;
  private exists = false;
  private loadSequence = 0;
  private editVersion = 0;
  private savedVersion = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight: Promise<boolean> | null = null;
  private flushRequested = false;

  private snapshot() {
    return {
      quote: readQuoteForm(this.form),
      issues: quoteFormIssues(this.form),
      dirty: this.form.dirty,
    };
  }

  // Deriva valores y estados de los eventos del formulario; no hay otra copia editable.
  private readonly state = toSignal(this.form.events.pipe(map(() => this.snapshot())), {
    initialValue: this.snapshot(),
  });
  readonly quote = computed(() => this.state().quote);
  readonly issues = computed(() => this.state().issues);
  readonly hasChanges = computed(() => this.state().dirty);
  readonly calculation = computed(() => calculateQuote(this.quote()));

  readonly hasContent = computed(() => {
    const quote = this.quote();
    return (
      this.hasChanges() ||
      quote.revision > 1 ||
      quote.lines.length > 0 ||
      [
        quote.title,
        ...Object.values(quote.issuer),
        ...Object.values(quote.client),
        ...Object.values(quote.payment),
        quote.conditions.terms,
        quote.conditions.notes,
      ].some(Boolean) ||
      quote.conditions.includesFirstMonthlyPayment
    );
  });

  constructor() {
    this.form.disable({ emitEvent: false });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.onEdit());
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      this.autoSaveEnabled = false;
      this.loadSequence++;
    });
  }

  async open(id: string | null, discardPending = false): Promise<string | null> {
    if (!discardPending && this.hasPendingChanges() && !(await this.flush())) return null;
    // Solo al activarse una ruta cuyo descarte ha confirmado el usuario.
    if (discardPending) this.hasPendingChanges.set(false);
    const sequence = ++this.loadSequence;
    this.autoSaveEnabled = false;
    this.clearTimer();
    this.loadState.set('loading');
    this.loadError.set('');
    this.commercialError.set('');
    this.form.disable({ emitEvent: false });
    if (id === null && !this.defaultsApplied) {
      try {
        const settings = await this.settingsRepository.load();
        if (sequence !== this.loadSequence) return null;
        const quote = readQuoteForm(this.form);
        replaceQuoteForm(
          this.form,
          {
            ...quote,
            ...quoteDates(settings.validityDays),
            issuer: structuredClone(settings.issuer),
            brand: structuredClone(settings.brand),
            payment: structuredClone(settings.payment),
            conditions: structuredClone(settings.conditions),
          },
          false,
        );
        this.defaultsApplied = true;
        this.catalog.set(settings.catalog);
        this.suggestedVatRate = settings.suggestedVatRate;
      } catch {
        this.loadState.set('load-error');
        this.loadError.set(
          'No se pudo leer la configuración para crear el presupuesto. Reintenta la carga.',
        );
        return null;
      }
    }
    try {
      const quote =
        id === null
          ? await this.repository.create(readQuoteForm(this.form))
          : await this.repository.findById(id);
      if (sequence !== this.loadSequence) return null;
      if (!quote) {
        this.loadState.set('not-found');
        return null;
      }
      if (quote.status !== 'draft') {
        this.closedQuote.set(quote);
        this.loadState.set('read-only');
        return quote.id;
      }
      this.closedQuote.set(null);
      this.applyStored(quote);
      if (id !== null) void this.loadCatalog();
      return quote.id;
    } catch (error) {
      if (sequence !== this.loadSequence) return null;
      if (id === null) {
        // Si falla la creación, se permite editar y exportar este mismo borrador antes de reintentar.
        this.exists = false;
        this.editVersion = 1;
        this.savedVersion = 0;
        this.form.enable({ emitEvent: false });
        this.loadState.set('ready');
        this.hasPendingChanges.set(true);
        this.autoSaveEnabled = true;
        this.failSave(error);
      } else {
        this.loadState.set('load-error');
        this.loadError.set(
          this.errorMessage(error, 'No se pudo leer el presupuesto. Reintenta la carga.'),
        );
      }
      return null;
    }
  }

  /** Se invoca solo después de confirmar el descarte. Un fallo de lectura conserva el formulario. */
  async reloadStored(): Promise<boolean> {
    if (this.inFlight || this.reloading()) return false;
    this.clearTimer();
    this.autoSaveEnabled = false;
    this.reloading.set(true);
    this.loadError.set('');
    this.form.disable({ emitEvent: false });
    try {
      const quote = await this.repository.findById(this.form.controls.metadata.value.id);
      if (this.destroyRef.destroyed) return false;
      if (!quote)
        throw new QuoteRepositoryError('not-found', 'El presupuesto almacenado ya no existe.');
      if (quote.status !== 'draft') {
        this.closedQuote.set(quote);
        this.hasPendingChanges.set(false);
        this.loadState.set('read-only');
        this.saveState.set('saved');
      } else this.applyStored(quote);
      return true;
    } catch (error) {
      this.loadError.set(
        this.errorMessage(
          error,
          'No se pudo cargar la versión almacenada. Tus cambios locales se conservan.',
        ),
      );
      return false;
    } finally {
      this.reloading.set(false);
      if (this.loadState() === 'ready') {
        this.form.enable({ emitEvent: false });
        this.autoSaveEnabled = true;
      }
    }
  }

  private applyStored(quote: DraftQuote): void {
    this.autoSaveEnabled = false;
    replaceQuoteForm(this.form, quote, false);
    this.form.enable({ emitEvent: false });
    this.form.updateValueAndValidity();
    this.exists = true;
    this.editVersion = 0;
    this.savedVersion = 0;
    this.hasPendingChanges.set(false);
    this.savedAt.set(quote.updatedAt);
    this.saveError.set('');
    this.numberError.set('');
    this.saveState.set('saved');
    this.loadState.set('ready');
    this.autoSaveEnabled = true;
  }

  private onEdit(): void {
    if (!this.autoSaveEnabled || this.suppressChanges || !this.canEdit()) return;
    this.editVersion++;
    this.hasPendingChanges.set(true);
    this.clearTimer();
    // Los errores requieren una acción explícita; un conflicto nunca se reintenta a ciegas.
    if (this.saveState() === 'conflict' || this.saveState() === 'error') return;
    this.saveState.set(this.inFlight ? 'saving' : 'unsaved');
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.startSave();
    }, 500);
  }

  /** Omite el debounce para reintentar o completar la navegación; comparte la escritura en curso. */
  flush(): Promise<boolean> {
    this.clearTimer();
    if (!this.hasPendingChanges()) return Promise.resolve(true);
    if (!this.canEdit() || this.saveState() === 'conflict') return Promise.resolve(false);
    this.flushRequested = true;
    return this.startSave();
  }

  private startSave(): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    if (!this.hasPendingChanges()) return Promise.resolve(true);
    if (!this.canEdit() || this.saveState() === 'conflict') return Promise.resolve(false);
    this.inFlight = this.writePending().finally(() => {
      this.inFlight = null;
      this.flushRequested = false;
    });
    return this.inFlight;
  }

  private async writePending(): Promise<boolean> {
    while (this.hasPendingChanges() && !this.destroyRef.destroyed) {
      const version = this.editVersion;
      const snapshot = readQuoteForm(this.form);
      const creating = !this.exists;
      this.saveState.set('saving');
      this.saveError.set('');
      try {
        const saved = this.exists
          ? await this.repository.save(snapshot, snapshot.revision)
          : await this.repository.create(snapshot);
        if (this.destroyRef.destroyed) return false;
        this.exists = true;
        this.savedVersion = version;
        // Actualiza solo los metadatos: una respuesta antigua no debe pisar nuevas ediciones.
        this.suppressChanges = true;
        if (creating && this.form.controls.number.value === snapshot.number)
          this.form.controls.number.setValue(saved.number);
        this.form.controls.metadata.setValue({
          ...this.form.controls.metadata.value,
          revision: saved.revision,
          updatedAt: saved.updatedAt,
        });
        this.suppressChanges = false;
        this.numberError.set('');
        this.savedAt.set(saved.updatedAt);
        this.hasPendingChanges.set(this.editVersion !== this.savedVersion);
        if (!this.hasPendingChanges()) {
          this.clearTimer();
          this.saveState.set('saved');
          return true;
        }
        // Si aún no ha vencido el debounce de una nueva edición, se respeta salvo al salir/reintentar.
        if (this.timer && !this.flushRequested) {
          this.saveState.set('unsaved');
          return false;
        }
      } catch (error) {
        this.suppressChanges = false;
        this.clearTimer();
        this.failSave(error);
        return false;
      }
    }
    return !this.hasPendingChanges();
  }

  private failSave(error: unknown): void {
    this.numberError.set(
      error instanceof QuoteRepositoryError && error.code === 'duplicate-number'
        ? error.message
        : '',
    );
    this.saveState.set(
      error instanceof QuoteRepositoryError && error.code === 'conflict' ? 'conflict' : 'error',
    );
    this.saveError.set(
      this.errorMessage(
        error,
        'No se pudo guardar el presupuesto. Tus cambios siguen en el formulario.',
      ),
    );
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof QuoteRepositoryError) return error.message;
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'QuotaExceededError'
    )
      return 'No queda espacio para guardar en este navegador. Descarga el borrador antes de liberar espacio.';
    return fallback;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  addLine(): string | undefined {
    if (!this.canEdit() || this.form.controls.lines.length >= this.maxLines) return undefined;
    const line = createLineForm();
    line.controls.vat.controls.rate.setValue(this.suggestedVatRate);
    this.form.markAsDirty({ emitEvent: false });
    this.form.controls.lines.push(line);
    return line.controls.id.value;
  }

  duplicateLine(index: number): string | undefined {
    const lines = this.form.controls.lines;
    if (!this.canEdit() || !lines.controls[index] || lines.length >= this.maxLines)
      return undefined;
    // Copia los controles crudos: también conserva una entrada todavía incompleta o inválida.
    const copy = createLineForm();
    copy.setValue({ ...lines.at(index).getRawValue(), id: crypto.randomUUID() });
    this.form.markAsDirty({ emitEvent: false });
    lines.insert(index + 1, copy);
    return copy.controls.id.value;
  }

  removeLine(index: number): void {
    if (!this.canEdit() || !this.form.controls.lines.controls[index]) return;
    this.form.markAsDirty({ emitEvent: false });
    this.form.controls.lines.removeAt(index);
  }

  moveLine(index: number, direction: -1 | 1): string | undefined {
    const lines = this.form.controls.lines;
    const target = index + direction;
    if (!this.canEdit() || !lines.controls[index] || target < 0 || target >= lines.length)
      return undefined;
    const line = lines.at(index);
    lines.removeAt(index, { emitEvent: false });
    lines.insert(target, line, { emitEvent: false });
    this.form.markAsDirty({ emitEvent: false });
    lines.updateValueAndValidity();
    return line.controls.id.value;
  }

  loadExample(): void {
    if (!this.canEdit()) return;
    const example = createReferenceQuote();
    const metadata = this.form.controls.metadata.value;
    replaceQuoteForm(this.form, {
      ...example,
      number: this.form.controls.number.value,
      id: metadata.id,
      createdAt: metadata.createdAt,
      revision: metadata.revision,
      updatedAt: metadata.updatedAt,
    });
  }

  async loadCatalog(): Promise<void> {
    if (this.catalogLoading()) return;
    this.catalogLoading.set(true);
    this.catalogError.set('');
    try {
      const settings = await this.settingsRepository.load();
      if (this.destroyRef.destroyed) return;
      this.catalog.set(settings.catalog);
      this.suggestedVatRate = settings.suggestedVatRate;
    } catch {
      this.catalogError.set(
        'No se pudo leer el catálogo. Puedes reintentar o añadir líneas manuales.',
      );
    } finally {
      this.catalogLoading.set(false);
    }
  }

  addTemplate(id: string): string | undefined {
    const template = this.catalog().find((item) => item.id === id);
    if (!template || !this.canEdit() || this.form.controls.lines.length >= this.maxLines)
      return undefined;
    const line = createLineForm(templateLine(template));
    this.form.markAsDirty({ emitEvent: false });
    this.form.controls.lines.push(line);
    return line.controls.id.value;
  }

  async markSent(): Promise<boolean> {
    if (!this.canEdit() || this.commercialBusy()) return false;
    this.commercialBusy.set(true);
    this.commercialError.set('');
    try {
      if (!(await this.flush())) return false;
      if (this.form.invalid) {
        this.commercialError.set(
          'Completa los campos del documento antes de marcarlo como enviado.',
        );
        return false;
      }
      this.closingContent.set(true);
      this.form.disable({ emitEvent: false });
      const quote = readQuoteForm(this.form);
      this.closedQuote.set(await this.repository.changeStatus(quote.id, quote.revision, 'sent'));
      this.autoSaveEnabled = false;
      this.loadState.set('read-only');
      return true;
    } catch (error) {
      if (error instanceof QuoteRepositoryError && error.code === 'conflict') {
        this.hasPendingChanges.set(true);
        this.failSave(error);
      }
      this.commercialError.set(
        this.errorMessage(error, 'No se pudo cambiar el estado. El borrador se conserva.'),
      );
      return false;
    } finally {
      this.closingContent.set(false);
      this.commercialBusy.set(false);
      if (this.loadState() === 'ready') this.form.enable({ emitEvent: false });
    }
  }

  async changeCommercialStatus(status: FinalizedQuote['status']): Promise<void> {
    const quote = this.closedQuote();
    if (!quote || this.commercialBusy()) return;
    this.commercialBusy.set(true);
    this.commercialError.set('');
    try {
      this.closedQuote.set(await this.repository.changeStatus(quote.id, quote.revision, status));
    } catch (error) {
      this.commercialError.set(
        this.errorMessage(error, 'No se pudo guardar el estado. Reintenta o recarga el documento.'),
      );
    } finally {
      this.commercialBusy.set(false);
    }
  }

  async createRevision(): Promise<string | null> {
    const quote = this.closedQuote();
    if (!quote || this.commercialBusy()) return null;
    this.commercialBusy.set(true);
    this.commercialError.set('');
    try {
      const settings = await this.settingsRepository.load();
      return (
        await this.repository.copy(quote.id, quote.revision, settings.validityDays, 'revision')
      ).id;
    } catch (error) {
      this.commercialError.set(
        this.errorMessage(error, 'No se pudo crear la revisión. El original se conserva.'),
      );
      return null;
    } finally {
      this.commercialBusy.set(false);
    }
  }
}
