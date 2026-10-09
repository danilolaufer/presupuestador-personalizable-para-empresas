import { Component, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuoteField } from '../../shared/ui/quote-field';
import { createLineForm } from '../quotes/quote-editor/quote-form';
import { settingsIssues } from './app-settings';
import { createSettingsForm, readSettingsForm } from './settings-form';
import { SETTINGS_REPOSITORY, SettingsConflictError } from './settings-repository';
import { readLogoFile } from './logo-file';
import { BackupControls } from './backup-controls';

@Component({
  selector: 'app-settings',
  imports: [ReactiveFormsModule, QuoteField, DatePipe, BackupControls],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private readonly repository = inject(SETTINGS_REPOSITORY);
  private readonly destroyRef = inject(DestroyRef);
  form = createSettingsForm();
  readonly loaded = signal(false);
  readonly state = signal<'loading' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict'>(
    'loading',
  );
  readonly error = signal('');
  readonly issues = signal<string[]>([]);
  readonly savedAt = signal<string | null>(null);
  readonly pending = signal(false);
  readonly logoBusy = signal(false);
  readonly logoError = signal('');
  readonly backupBusy = signal(false);
  readonly runBackup = async (work: () => Promise<void>, savePending = true): Promise<void> => {
    if (this.backupBusy() || this.logoBusy() || !this.loaded() || this.state() === 'loading')
      throw new Error('Espera a que termine la carga de configuración o del logo.');
    if (savePending && this.pending() && !(await this.save()))
      throw new Error('Guarda o corrige los cambios de configuración antes de gestionar la copia.');
    this.backupBusy.set(true);
    this.form.disable({ emitEvent: false });
    try {
      await work();
    } finally {
      this.backupBusy.set(false);
      if (this.state() !== 'loading') this.form.enable({ emitEvent: false });
    }
  };
  private revision = 0;
  private version = 0;
  private writing: Promise<boolean> | null = null;
  private loadSequence = 0;
  readonly issuerFields = [
    ['name', 'Razón social'],
    ['taxId', 'Identificación fiscal'],
    ['address', 'Dirección'],
    ['phone', 'Teléfono'],
    ['email', 'Correo electrónico'],
  ] as const;
  readonly paymentFields = [
    ['method', 'Forma de pago'],
    ['holder', 'Titular'],
    ['iban', 'IBAN'],
    ['instructions', 'Instrucciones'],
  ] as const;

  ngOnInit(): void {
    void this.load();
  }

  async load(discard = false): Promise<void> {
    if (this.writing || this.logoBusy()) return;
    if (
      this.pending() &&
      (!discard ||
        !window.confirm(
          '¿Descartar los cambios locales de configuración y cargar la versión guardada?',
        ))
    )
      return;
    const sequence = ++this.loadSequence;
    this.state.set('loading');
    this.error.set('');
    this.form.disable({ emitEvent: false });
    try {
      const settings = await this.repository.load();
      if (sequence !== this.loadSequence || this.destroyRef.destroyed) return;
      // Conserva la única fuente editable; la anterior ya no tiene controles en pantalla.
      this.form = createSettingsForm(settings);
      this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.version++;
        this.pending.set(true);
        if (this.state() !== 'conflict' && this.state() !== 'saving') this.state.set('unsaved');
      });
      this.revision = settings.revision;
      this.savedAt.set(settings.updatedAt);
      this.pending.set(false);
      this.loaded.set(true);
      this.issues.set([]);
      this.state.set(settings.updatedAt ? 'saved' : 'unsaved');
    } catch (error) {
      this.state.set('error');
      this.error.set(this.message(error));
      if (this.loaded()) this.form.enable({ emitEvent: false });
    }
  }

  save(): Promise<boolean> {
    if (this.backupBusy()) return Promise.resolve(false);
    if (this.writing) return this.writing;
    if (
      !this.loaded() ||
      this.logoBusy() ||
      this.state() === 'loading' ||
      this.state() === 'conflict'
    )
      return Promise.resolve(false);
    this.writing = this.write().finally(() => {
      this.writing = null;
    });
    return this.writing;
  }
  private async write(): Promise<boolean> {
    const snapshot = readSettingsForm(this.form, this.revision);
    const issues = settingsIssues(snapshot);
    this.issues.set(issues);
    if (issues.length) {
      this.form.markAllAsTouched();
      return false;
    }
    const version = this.version;
    this.state.set('saving');
    this.error.set('');
    this.form.disable({ emitEvent: false });
    try {
      const saved = await this.repository.save(snapshot, this.revision);
      this.revision = saved.revision;
      this.savedAt.set(saved.updatedAt);
      this.pending.set(this.version !== version);
      this.state.set(this.pending() ? 'unsaved' : 'saved');
      return !this.pending();
    } catch (error) {
      this.state.set(error instanceof SettingsConflictError ? 'conflict' : 'error');
      this.error.set(this.message(error));
      return false;
    } finally {
      this.form.enable({ emitEvent: false });
    }
  }

  addTemplate(): void {
    if (
      this.state() === 'saving' ||
      this.state() === 'loading' ||
      this.form.controls.catalog.length >= 1000
    )
      return;
    const line = createLineForm();
    line.controls.vat.controls.rate.setValue(this.form.controls.suggestedVatRate.value);
    this.form.controls.catalog.push(line);
  }
  removeTemplate(index: number): void {
    const template = this.form.controls.catalog.at(index);
    if (this.state() === 'saving' || this.state() === 'loading' || !template) return;
    if (
      window.confirm(
        '¿Eliminar la plantilla «' +
          (template.controls.name.value || 'Sin nombre') +
          '»? Los presupuestos anteriores conservarán su copia.',
      )
    )
      this.form.controls.catalog.removeAt(index);
  }
  async chooseLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.logoBusy() || this.state() === 'saving') return;
    this.logoBusy.set(true);
    this.logoError.set('');
    try {
      this.form.controls.brand.controls.logoDataUrl.setValue(await readLogoFile(file));
    } catch (error) {
      this.logoError.set(this.message(error));
    } finally {
      input.value = '';
      this.logoBusy.set(false);
    }
  }
  async confirmLeave(): Promise<boolean> {
    if (this.backupBusy()) {
      this.error.set('Espera a que termine la operación de copia antes de salir.');
      return false;
    }
    if (this.logoBusy()) {
      this.logoError.set('Espera a que termine la lectura del logo antes de salir.');
      return false;
    }
    if (!this.pending() || (await this.save())) return true;
    return window.confirm(
      'La configuración no se ha guardado. Cancela para conservar los cambios en pantalla. ¿Salir y descartarlos?',
    );
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.pending() || this.logoBusy() || this.backupBusy()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  private message(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'No se pudo guardar o leer la configuración. Tus cambios se conservan.';
  }
}
