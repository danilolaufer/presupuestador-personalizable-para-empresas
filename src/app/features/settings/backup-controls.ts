import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BackupService,
  importReasons,
  type ImportChoice,
  type ImportReview,
} from '../../core/backup/backup-service';
import { MAX_BACKUP_BYTES } from '../../core/backup/backup-format';
import { JsonDownload } from '../../core/backup/json-download';
import { QUOTE_REPOSITORY } from '../quotes/quote-repository';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { copyQuote } from '../../domain/quotes/quote-lifecycle';
import { QUOTE_STATUS_LABELS } from '../quotes/quote-presentation';

@Component({
  selector: 'app-backup-controls',
  imports: [RouterLink],
  templateUrl: './backup-controls.html',
  styleUrl: './backup-controls.scss',
})
export class BackupControls {
  private readonly service = inject(BackupService);
  private readonly download = inject(JsonDownload);
  private readonly quotes = inject(QUOTE_REPOSITORY);
  readonly runOperation =
    input.required<(work: () => Promise<void>, savePending?: boolean) => Promise<void>>();
  readonly restored = output<void>();
  readonly review = signal<ImportReview | null>(null);
  readonly choices = signal<Record<string, ImportChoice>>({});
  readonly includeSettings = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly demoId = signal('');
  readonly labels = QUOTE_STATUS_LABELS;
  private sourceText = '';
  readonly reasons = computed(() => {
    const review = this.review();
    return review
      ? importReasons(review.backup, review.existing, this.choices())
      : new Map<string, string>();
  });
  readonly summary = computed(() => {
    const choices = Object.values(this.choices());
    return {
      original: choices.filter((value) => value === 'restore').length,
      copy: choices.filter((value) => value === 'copy').length,
      skipped: choices.filter((value) => value === 'skip').length,
    };
  });
  readonly blocked = computed(() =>
    Object.entries(this.choices()).some(
      ([id, choice]) => choice === 'restore' && this.reasons().has(id),
    ),
  );

  async export(): Promise<void> {
    await this.perform(async () => {
      const backup = await this.service.export();
      this.download.download(
        backup,
        `presupuestador-${backup.exportedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`,
      );
      this.message.set(
        'Copia preparada. Comprueba que el archivo JSON se ha descargado y consérvalo fuera de este navegador.',
      );
    });
  }
  async chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.review.set(null);
    this.sourceText = '';
    await this.perform(async () => {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('La copia supera los 50 MiB.');
      const text = await file.text();
      await this.readReview(text);
    }, false);
  }
  async refresh(): Promise<void> {
    await this.perform(() => this.readReview(this.sourceText), false);
  }
  private async readReview(text: string): Promise<void> {
    const review = await this.service.review(text);
    this.sourceText = text;
    this.review.set(review);
    this.choices.set(Object.fromEntries(review.rows.map((row) => [row.quote.id, row.choice])));
    this.includeSettings.set(false);
    this.message.set(
      'Archivo validado. Revisa las decisiones: todavía no se ha importado ningún dato.',
    );
  }
  select(id: string, event: Event): void {
    this.choices.update((choices) => ({
      ...choices,
      [id]: (event.target as HTMLSelectElement).value as ImportChoice,
    }));
  }
  async restore(): Promise<void> {
    const review = this.review();
    if (!review || this.blocked()) return;
    await this.perform(async () => {
      const count = await this.service.restore(review, this.choices(), this.includeSettings());
      const settings = !!review.backup.settings && this.includeSettings();
      this.cancel();
      this.message.set(
        `Restauración completada: ${count} presupuestos añadidos. ${settings ? 'Configuración importada.' : 'Configuración existente conservada.'}`,
      );
      this.restored.emit();
    });
  }
  cancel(): void {
    this.review.set(null);
    this.sourceText = '';
    this.choices.set({});
    this.includeSettings.set(false);
    this.error.set('');
    this.message.set('Revisión cerrada.');
  }
  async createDemo(): Promise<void> {
    await this.perform(async () => {
      const quote = await this.quotes.create(copyQuote(createReferenceQuote(), 30));
      this.demoId.set(quote.id);
      this.message.set(
        'Presupuesto ficticio creado con número propio. Los presupuestos y la configuración existentes se conservan.',
      );
    });
  }
  private async perform(work: () => Promise<void>, savePending = true): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await this.runOperation()(work, savePending);
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'No se pudo completar la operación. No cierres la aplicación.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
