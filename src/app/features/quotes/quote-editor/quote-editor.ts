import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EmergencyQuoteBackup } from '../../../core/backup/emergency-quote-backup';
import type { ValidationIssue } from '../../../domain/quotes/validate-quote';
import { readQuoteForm, type QuoteLineForm } from './quote-form';
import { QuoteEditorStore } from './quote-editor-store';
import { QuoteField } from '../../../shared/ui/quote-field';
import { QuoteRecord } from '../quote-record/quote-record';

@Component({
  selector: 'app-quote-editor',
  imports: [ReactiveFormsModule, QuoteField, RouterLink, QuoteRecord],
  providers: [QuoteEditorStore],
  templateUrl: './quote-editor.html',
  styleUrl: './quote-editor.scss',
})
export class QuoteEditor implements OnInit {
  readonly store = inject(QuoteEditorStore);
  readonly form = this.store.form;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly backup = inject(EmergencyQuoteBackup);
  private discardOnRouteChange = false;
  private readonly exampleDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('exampleDialog');
  private readonly conflictDialog = viewChild<ElementRef<HTMLDialogElement>>('conflictDialog');
  readonly reviewed = signal(false);
  readonly actionMessage = signal('');
  readonly catalogSearch = signal('');
  readonly filteredCatalog = computed(() => {
    const term = this.catalogSearch().trim().toLocaleLowerCase('es');
    return this.store
      .catalog()
      .filter((item) =>
        (item.name + ' ' + item.description).toLocaleLowerCase('es').includes(term),
      );
  });
  readonly parties = [
    { key: 'issuer', title: 'Emisor', group: this.form.controls.issuer },
    { key: 'client', title: 'Cliente', group: this.form.controls.client },
  ] as const;
  private readonly errorsByField = computed(
    () =>
      new Map(
        this.store.issues().map((issue) => [`${issue.lineId ?? ''}:${issue.field}`, issue.message]),
      ),
  );
  readonly summaryGroups = computed(() => {
    const calculation = this.store.calculation();
    if (calculation.status !== 'valid') return [];
    return [
      { title: 'Cuota mensual', amounts: calculation.totals.monthly },
      { title: 'Pago único', amounts: calculation.totals.oneTime },
      {
        title: this.store.quote().conditions.includesFirstMonthlyPayment
          ? 'Pago inicial'
          : 'Conjunto de conceptos',
        amounts: calculation.totals.combined,
      },
    ];
  });

  fieldId(field: string, line?: QuoteLineForm): string {
    return `${line ? `line-${line.controls.id.value}` : 'quote'}-${field.replaceAll('.', '-')}`;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.openRoute(params.get('id'));
    });
  }

  private async openRoute(id: string | null): Promise<void> {
    const discardPending = this.discardOnRouteChange;
    this.discardOnRouteChange = false;
    const savedId = await this.store.open(id, discardPending);
    if (id === null && savedId && !this.destroyRef.destroyed) await this.navigateToSaved(savedId);
  }

  private async navigateToSaved(id: string): Promise<void> {
    try {
      await this.router.navigate(['/presupuestos', id, 'editar'], { replaceUrl: true });
    } catch {
      this.actionMessage.set(
        'El presupuesto está guardado, pero no se pudo abrir su dirección de edición.',
      );
    }
  }

  retryLoad(): void {
    void this.openRoute(this.route.snapshot.paramMap.get('id'));
  }

  async retrySave(): Promise<void> {
    if (
      (await this.store.flush()) &&
      !this.route.snapshot.paramMap.has('id') &&
      !this.destroyRef.destroyed
    )
      await this.navigateToSaved(this.form.controls.metadata.value.id);
  }

  downloadEmergency(): void {
    try {
      this.backup.download(readQuoteForm(this.form));
    } catch {
      this.actionMessage.set('No se pudo iniciar la descarga. El borrador sigue en el formulario.');
    }
  }

  requestStoredVersion(): void {
    this.conflictDialog()?.nativeElement.showModal();
  }
  cancelStoredVersion(): void {
    this.conflictDialog()?.nativeElement.close();
  }
  async confirmStoredVersion(): Promise<void> {
    this.conflictDialog()?.nativeElement.close();
    if (await this.store.reloadStored()) {
      this.reviewed.set(false);
      this.actionMessage.set('Versión almacenada cargada. Se han descartado los cambios locales.');
    }
  }

  formatSavedAt(value: string | null): string {
    return value ? new Date(value).toLocaleTimeString('es-ES') : '';
  }

  fieldError(field: string, line?: QuoteLineForm): string {
    if (field === 'number' && this.store.numberError()) return this.store.numberError();
    const control = line ? line.get(field) : this.form.get(field);
    if (!this.reviewed() && !control?.dirty && !control?.touched) return '';
    if (control?.hasError('email')) return 'Introduce un correo válido o deja el campo vacío.';
    const message = this.errorsByField().get(`${line?.controls.id.value ?? ''}:${field}`) ?? '';
    return message.replace(
      'con punto, sin espacios ni símbolos',
      'con coma o punto decimal, sin separadores de miles ni símbolos',
    );
  }

  formatMoney(value: string): string {
    const [integer, fraction] = value.split('.');
    return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction} €`;
  }

  issueLabel(issue: ValidationIssue): string {
    const labels: Record<string, string> = {
      quantity: 'Cantidad',
      unitPrice: 'Precio sin IVA',
      'discount.value': 'Descuento',
      'vat.rate': 'Tipo de IVA',
      lines: 'Servicios',
      frequency: 'Periodicidad',
    };
    return `${issue.lineIndex === undefined ? '' : `Servicio ${issue.lineIndex + 1}: `}${labels[issue.field] ?? 'Campo pendiente'}`;
  }

  requestExample(): void {
    if (!this.store.canEdit()) return;
    if (this.store.hasContent()) this.exampleDialog().nativeElement.showModal();
    else this.loadExample();
  }

  confirmExample(): void {
    this.exampleDialog().nativeElement.close();
    this.loadExample();
  }

  cancelExample(): void {
    this.exampleDialog().nativeElement.close();
  }

  private loadExample(): void {
    this.store.loadExample();
    this.reviewed.set(false);
    this.actionMessage.set('Ejemplo cargado con tres servicios. Puedes editar todos sus campos.');
    this.focusLine(this.form.controls.lines.at(0).controls.id.value);
  }

  addLine(): void {
    const id = this.store.addLine();
    if (!id) return;
    this.actionMessage.set('Servicio añadido. Completa sus datos.');
    this.focusLine(id);
  }

  searchCatalog(event: Event): void {
    this.catalogSearch.set((event.target as HTMLInputElement).value);
  }
  addTemplate(id: string): void {
    const lineId = this.store.addTemplate(id);
    if (lineId) {
      this.actionMessage.set('Plantilla copiada como una línea independiente.');
      this.focusLine(lineId);
    }
  }
  async markSent(): Promise<void> {
    if (!(await this.store.markSent()) && this.form.invalid) this.reviewFields();
  }
  async openPreview(): Promise<void> {
    if (!(await this.store.flush())) {
      this.actionMessage.set(
        'No se puede abrir la vista previa hasta guardar los cambios. Reintenta o descarga el borrador.',
      );
      return;
    }
    if (!this.destroyRef.destroyed)
      await this.router.navigate(['/presupuestos', this.store.quote().id, 'vista-previa']);
  }
  async createRevision(): Promise<void> {
    const id = await this.store.createRevision();
    if (id && !this.destroyRef.destroyed) await this.navigateToSaved(id);
  }

  duplicateLine(index: number): void {
    const id = this.store.duplicateLine(index);
    if (!id) return;
    this.actionMessage.set(`Servicio ${index + 1} duplicado con un identificador nuevo.`);
    this.focusLine(id);
  }

  removeLine(index: number): void {
    this.store.removeLine(index);
    this.actionMessage.set(`Servicio ${index + 1} eliminado.`);
    const next =
      this.form.controls.lines.controls[Math.min(index, this.form.controls.lines.length - 1)];
    if (next) this.focusLine(next.controls.id.value);
    else this.focusAfterRender('add-line');
  }

  moveLine(index: number, direction: -1 | 1): void {
    const id = this.store.moveLine(index, direction);
    if (!id) return;
    this.actionMessage.set(`Servicio movido a la posición ${index + direction + 1}.`);
    this.focusLine(id);
  }

  reviewFields(): void {
    this.reviewed.set(true);
    this.form.markAllAsTouched();
    this.actionMessage.set(
      this.form.valid
        ? 'Campos revisados: el borrador está completo.'
        : 'Hay campos pendientes o inválidos. Revisa los mensajes junto a cada campo.',
    );
    const issue = this.store.issues()[0];
    if (issue) {
      const line = this.form.controls.lines.controls.find(
        (item) => item.controls.id.value === issue.lineId,
      );
      this.focusAfterRender(this.fieldId(issue.field, line));
    } else if (this.form.invalid) {
      const party = this.parties.find((item) => item.group.controls.email.invalid);
      if (party) this.focusAfterRender(this.fieldId(`${party.key}.email`));
    }
  }

  async confirmLeave(): Promise<boolean> {
    this.discardOnRouteChange = false;
    if (await this.store.flush()) return true;
    const leave = window.confirm(
      'No se han podido guardar todos los cambios. Pulsa Cancelar para quedarte, reintentar o descargar el borrador. Si aceptas salir, perderás los cambios locales pendientes. ¿Quieres salir?',
    );
    // No descarta aún: si la navegación no se activa, el formulario sigue pendiente.
    this.discardOnRouteChange = leave;
    return leave;
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  private focusLine(id: string): void {
    this.focusAfterRender(`line-${id}-name`);
  }

  private focusAfterRender(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
