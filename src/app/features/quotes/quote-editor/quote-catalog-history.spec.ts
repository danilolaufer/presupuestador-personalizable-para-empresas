import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { AppDatabase } from '../../../core/persistence/app-database';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { IndexedDbQuoteRepository } from '../indexeddb-quote-repository';
import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { IndexedDbSettingsRepository } from '../../settings/indexeddb-settings-repository';
import { defaultSettings } from '../../settings/app-settings';
import { QuoteEditorStore } from './quote-editor-store';
import { readQuoteForm } from './quote-form';
import { quoteDates } from '../../../domain/quotes/quote-lifecycle';
import { deferred } from '../testing/memory-quote-repository';

describe('Configuración, catálogo y copias del editor con IndexedDB', () => {
  let database: AppDatabase;
  let quotes: IndexedDbQuoteRepository;
  let settings: IndexedDbSettingsRepository;
  const newEditor = () => TestBed.runInInjectionContext(() => new QuoteEditorStore());
  beforeEach(() => {
    database = new AppDatabase(new IDBFactory(), crypto.randomUUID());
    quotes = new IndexedDbQuoteRepository(database);
    settings = new IndexedDbSettingsRepository(database);
    TestBed.configureTestingModule({
      providers: [
        { provide: QUOTE_REPOSITORY, useValue: quotes },
        { provide: SETTINGS_REPOSITORY, useValue: settings },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    database.close();
    vi.restoreAllMocks();
  });

  it('aplica configuración solo a nuevos documentos y copia plantillas sin vínculos de actualización', async () => {
    const original = await settings.save(
      {
        ...defaultSettings(),
        issuer: { ...defaultSettings().issuer, name: 'Empresa anterior' },
        brand: { ...defaultSettings().brand, name: 'Marca anterior' },
        payment: { ...defaultSettings().payment, holder: 'Titular anterior' },
        conditions: { ...defaultSettings().conditions, notes: 'Notas anteriores' },
        suggestedVatRate: '10',
        validityDays: 45,
        catalog: [
          {
            id: 'template-1',
            name: 'Servicio anterior',
            description: 'Descripción anterior',
            unit: 'sitio',
            unitPrice: '150.00',
            frequency: 'monthly',
            vat: { kind: 'taxed', rate: '21' },
          },
        ],
      },
      0,
    );
    const editor = newEditor();
    const id = await editor.open(null);
    expect(editor.quote()).toMatchObject({
      ...quoteDates(45),
      issuer: original.issuer,
      brand: original.brand,
      payment: original.payment,
      conditions: original.conditions,
    });
    const lineId = editor.addTemplate('template-1');
    expect(editor.quote().lines[0]).toMatchObject({
      id: lineId,
      sourceServiceId: 'template-1',
      name: 'Servicio anterior',
      unitPrice: '150.00',
      quantity: '1',
    });
    expect(lineId).not.toBe('template-1');
    expect(await editor.flush()).toBe(true);
    const snapshot = readQuoteForm(editor.form);
    const changed = await settings.save(
      {
        ...original,
        issuer: { ...original.issuer, name: 'Empresa nueva' },
        brand: { ...original.brand, name: 'Marca nueva' },
        catalog: original.catalog.map((template) => ({ ...template, unitPrice: '999.00' })),
      },
      1,
    );
    await editor.loadCatalog();
    expect(editor.quote().lines[0].unitPrice).toBe('150.00');
    editor.addTemplate('template-1');
    expect(editor.quote().lines[1].unitPrice).toBe('999.00');
    editor.removeLine(1);
    await editor.flush();
    await settings.save({ ...changed, catalog: [] }, 2);
    database.close();
    const recovered = newEditor();
    await recovered.open(id);
    expect(recovered.quote()).toMatchObject({
      issuer: snapshot.issuer,
      brand: snapshot.brand,
      payment: snapshot.payment,
      conditions: snapshot.conditions,
      lines: snapshot.lines,
    });
    await recovered.loadCatalog();
    expect(recovered.catalog()).toEqual([]);
    const next = newEditor();
    await next.open(null);
    expect(next.quote().issuer.name).toBe('Empresa nueva');
    expect(next.quote().brand.name).toBe('Marca nueva');
    next.addLine();
    expect(next.quote().lines[0].vat).toEqual({ kind: 'taxed', rate: '10' });
  });

  it('guarda las ediciones pendientes antes de enviar y bloquea contenido, también al recuperar', async () => {
    const editor = newEditor();
    const id = await editor.open(null);
    editor.loadExample();
    const gate = deferred<void>();
    const realSave = quotes.save.bind(quotes);
    vi.spyOn(quotes, 'save').mockImplementationOnce(async (quote, revision) => {
      await gate.promise;
      return realSave(quote, revision);
    });
    const sending = editor.markSent();
    editor.form.controls.lines.at(0).controls.quantity.setValue('10');
    gate.resolve(undefined);
    expect(await sending).toBe(true);
    expect(editor.closedQuote()?.totals.combined.total).toBe('2208.25');
    expect(editor.canEdit()).toBe(false);
    expect(editor.addLine()).toBeUndefined();
    const before = editor.closedQuote();
    database.close();
    const recovered = newEditor();
    await recovered.open(id);
    expect(recovered.closedQuote()).toEqual(before);
    await recovered.changeCommercialStatus('accepted');
    expect(recovered.closedQuote()?.lines).toEqual(before?.lines);
    const revisionId = await recovered.createRevision();
    expect(revisionId).not.toBe(id);
    await recovered.open(revisionId);
    expect(recovered.quote().revisionOfId).toBe(id);
    expect(recovered.canEdit()).toBe(true);
    recovered.form.controls.lines.at(0).controls.unitPrice.setValue('1.00');
    await recovered.flush();
    expect((await quotes.findById(id!))?.lines).toEqual(before?.lines);
  });

  it('bloquea envío incompleto y conserva el formulario si falla guardar o cambiar el estado', async () => {
    const editor = newEditor();
    await editor.open(null);
    editor.loadExample();
    editor.form.controls.lines.at(0).controls.unitPrice.setValue('');
    expect(await editor.markSent()).toBe(false);
    expect(editor.commercialError()).toContain('Completa');
    editor.form.controls.lines.at(0).controls.unitPrice.setValue('150.00');
    vi.spyOn(quotes, 'changeStatus').mockRejectedValueOnce(new Error('Fallo de estado'));
    expect(await editor.markSent()).toBe(false);
    expect(editor.form.controls.lines.at(0).controls.unitPrice.value).toBe('150.00');
    expect(editor.canEdit()).toBe(true);
    expect((await quotes.findById(editor.quote().id))?.status).toBe('draft');
    expect(await editor.markSent()).toBe(true);
  });

  it('permite cargar la versión cerrada de otra pestaña tras confirmar el descarte local', async () => {
    const first = newEditor();
    const id = await first.open(null);
    first.loadExample();
    await first.flush();
    const second = newEditor();
    await second.open(id);
    expect(await first.markSent()).toBe(true);
    second.form.controls.title.setValue('Edición local posterior');
    expect(await second.flush()).toBe(false);
    expect(second.saveState()).toBe('conflict');
    expect(second.quote().title).toBe('Edición local posterior');
    expect(await second.reloadStored()).toBe(true);
    expect(second.closedQuote()?.status).toBe('sent');
    expect(second.hasPendingChanges()).toBe(false);
    expect(second.form.disabled).toBe(true);
  });

  it('no crea un documento sin sus valores predeterminados si falla la lectura de configuración', async () => {
    const editor = newEditor();
    vi.spyOn(settings, 'load').mockRejectedValueOnce(new Error('Sin configuración'));
    expect(await editor.open(null)).toBeNull();
    expect(editor.loadState()).toBe('load-error');
    expect(await quotes.list()).toEqual([]);
    expect(await editor.open(null)).not.toBeNull();
    expect(editor.loadState()).toBe('ready');
  });
});
