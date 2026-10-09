import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { IDBFactory } from 'fake-indexeddb';
import { AppDatabase } from '../../core/persistence/app-database';
import { BackupService } from '../../core/backup/backup-service';
import { JsonDownload } from '../../core/backup/json-download';
import { IndexedDbSettingsRepository } from './indexeddb-settings-repository';
import { SETTINGS_REPOSITORY } from './settings-repository';
import { IndexedDbQuoteRepository } from '../quotes/indexeddb-quote-repository';
import { QUOTE_REPOSITORY } from '../quotes/quote-repository';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { Settings } from './settings';
import { BackupControls } from './backup-controls';
import { deferred } from '../quotes/testing/memory-quote-repository';

describe('Interfaz de copias en configuración', () => {
  let database: AppDatabase;
  let repository: IndexedDbQuoteRepository;
  let settingsRepository: IndexedDbSettingsRepository;
  let backup: BackupService;
  const download = { download: vi.fn() };
  beforeEach(() => {
    database = new AppDatabase(new IDBFactory(), 'backup-ui-' + crypto.randomUUID());
    repository = new IndexedDbQuoteRepository(database);
    settingsRepository = new IndexedDbSettingsRepository(database);
    backup = new BackupService(database, async () => {});
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: settingsRepository },
        { provide: BackupService, useValue: backup },
        { provide: JsonDownload, useValue: download },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    database.close();
    vi.restoreAllMocks();
    download.download.mockClear();
  });
  async function screen() {
    const fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loaded()).toBe(true));
    await fixture.whenStable();
    fixture.detectChanges();
    const controls = fixture.debugElement.query(By.directive(BackupControls))
      .componentInstance as BackupControls;
    return { fixture, settings: fixture.componentInstance, controls };
  }
  function fileEvent(text: string): Event {
    return {
      target: {
        files: [{ size: new TextEncoder().encode(text).length, text: async () => text }],
        value: 'test.json',
      },
    } as unknown as Event;
  }

  it('guarda cambios pendientes antes de exportar y usa nombre de archivo con fecha y hora', async () => {
    const { settings, controls } = await screen();
    settings.form.controls.issuer.controls.name.setValue('Empresa editada');
    await controls.export();
    expect(download.download).toHaveBeenCalledOnce();
    const [file, name] = download.download.mock.calls[0];
    expect(file.settings.issuer.name).toBe('Empresa editada');
    expect(name).toMatch(/^presupuestador-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(settings.pending()).toBe(false);
  });

  it('no exporta si falla el guardado de configuración y conserva el formulario', async () => {
    const { settings, controls } = await screen();
    settings.form.controls.issuer.controls.name.setValue('Pendiente');
    vi.spyOn(settingsRepository, 'save').mockRejectedValue(new Error('Almacenamiento lleno'));
    await controls.export();
    expect(download.download).not.toHaveBeenCalled();
    expect(settings.form.controls.issuer.controls.name.value).toBe('Pendiente');
    expect(controls.error()).toContain('cambios de configuración');
  });

  it('revisa un archivo, muestra resumen y colisiones, y permite cancelar sin escritura', async () => {
    const saved = await repository.create(createReferenceQuote());
    const text = JSON.stringify(await backup.export());
    const { fixture, controls } = await screen();
    await controls.chooseFile(fileEvent(text));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Revisar importación');
    expect(element.textContent).toContain(saved.number);
    expect(controls.choices()[saved.id]).toBe('skip');
    expect(controls.includeSettings()).toBe(false);
    const cancel = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Cancelar importación',
    )!;
    cancel.click();
    fixture.detectChanges();
    expect(controls.review()).toBeNull();
    expect(await repository.list()).toEqual([saved]);
  });

  it('recupera una copia como borrador solo tras confirmación explícita y conserva el original', async () => {
    const saved = await repository.create(createReferenceQuote());
    const { fixture, controls } = await screen();
    await controls.chooseFile(fileEvent(JSON.stringify(await backup.export())));
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      'select[id^=import-]',
    )!;
    select.value = 'copy';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(controls.choices()[saved.id]).toBe('copy');
    expect(await repository.list()).toHaveLength(1);
    await controls.restore();
    await fixture.whenStable();
    expect(controls.error()).toBe('');
    expect(await repository.list()).toHaveLength(2);
    expect(await repository.findById(saved.id)).toEqual(saved);
    expect(controls.message()).toContain('Restauración completada');
  });

  it('bloquea salida y modificaciones de configuración durante la transacción', async () => {
    const { settings, controls } = await screen();
    const gate = deferred<Awaited<ReturnType<BackupService['export']>>>();
    vi.spyOn(backup, 'export').mockReturnValue(gate.promise);
    const exporting = controls.export();
    expect(settings.backupBusy()).toBe(true);
    expect(settings.form.disabled).toBe(true);
    expect(await settings.confirmLeave()).toBe(false);
    expect(await settings.save()).toBe(false);
    gate.resolve({
      kind: 'presupuestador-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      quotes: [],
      settings: null,
      counters: [],
    });
    await exporting;
    expect(settings.backupBusy()).toBe(false);
    expect(settings.form.enabled).toBe(true);
  });

  it('revisar y cancelar no guarda ni descarta la configuración pendiente', async () => {
    const text = JSON.stringify(await backup.export());
    const { settings, controls } = await screen();
    settings.form.controls.issuer.controls.name.setValue('Todavía sin guardar');
    await controls.chooseFile(fileEvent(text));
    expect(controls.error()).toBe('');
    controls.cancel();
    expect(settings.pending()).toBe(true);
    expect(settings.form.controls.issuer.controls.name.value).toBe('Todavía sin guardar');
    expect((await settingsRepository.load()).revision).toBe(0);
  });

  it('crea la demostración con identidad y número nuevos sin reemplazar datos existentes', async () => {
    const saved = await repository.create(createReferenceQuote());
    const { controls } = await screen();
    await controls.createDemo();
    expect(controls.demoId()).not.toBe(saved.id);
    expect(await repository.list()).toHaveLength(2);
    expect(await repository.findById(saved.id)).toEqual(saved);
  });
});
