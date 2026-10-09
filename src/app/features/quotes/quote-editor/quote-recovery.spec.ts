import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { TestBed } from '@angular/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { AppDatabase } from '../../../core/persistence/app-database';
import { IndexedDbQuoteRepository } from '../indexeddb-quote-repository';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { QuoteEditorStore } from './quote-editor-store';
import { readQuoteForm } from './quote-form';

describe('Recuperación del formulario con el adaptador IndexedDB', () => {
  let database: AppDatabase;
  let repository: IndexedDbQuoteRepository;
  let store: QuoteEditorStore;

  beforeEach(() => {
    database = new AppDatabase(new IDBFactory(), crypto.randomUUID());
    repository = new IndexedDbQuoteRepository(database);
    TestBed.configureTestingModule({
      providers: [
        QuoteEditorStore,
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useClass: MemorySettingsRepository },
      ],
    });
    store = TestBed.inject(QuoteEditorStore);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    database.close();
  });

  it('recupera el documento completo y el orden tras Guardado, cierre de conexión y nuevo editor', async () => {
    const id = await store.open(null);
    store.loadExample();
    const form = store.form.controls;
    form.number.setValue('RECUPERACIÓN-2026');
    form.issueDate.setValue('2026-09-19');
    form.validUntil.setValue('2026-10-19');
    form.issuer.patchValue({
      name: 'Emisor ficticio editado',
      address: 'Dirección ficticia, 12',
      email: 'emisor@example.test',
      taxId: 'DEMO-EMISOR',
      phone: '000000001',
    });
    form.client.patchValue({
      name: 'Cliente ficticio editado',
      address: 'Otra dirección ficticia',
      email: 'cliente@example.test',
      taxId: 'DEMO-CLIENTE',
      phone: '000000002',
    });
    form.payment.setValue({
      holder: 'Titular ficticio',
      method: 'Transferencia de prueba',
      instructions: 'Instrucciones editadas',
      iban: 'IBAN FICTICIO',
    });
    form.conditions.setValue({
      terms: 'Condiciones editadas',
      notes: 'Observaciones\nCon otra línea',
      includesFirstMonthlyPayment: true,
    });
    form.metadata.setValue({
      ...form.metadata.value,
      brand: {
        name: 'Marca ficticia',
        logoDataUrl: 'data:image/png;base64,dGVzdA==',
        accentColor: '#112233',
      },
    });
    form.lines.at(0).patchValue({
      sourceServiceId: 'servicio-ficticio',
      name: 'Servicio editado',
      description: 'Descripción editada',
      unit: 'sitio',
      quantity: '10',
      unitPrice: '150,00',
      discount: { kind: 'fixed', value: '10,00' },
    });
    form.lines.at(1).patchValue({
      frequency: 'one-time',
      vat: { kind: 'exempt', note: 'Motivo fiscal de prueba' },
    });
    store.moveLine(2, -1);
    const order = form.lines.controls.map((line) => line.controls.id.value);
    expect(await store.flush()).toBe(true);
    expect(store.saveState()).toBe('saved');
    const saved = readQuoteForm(store.form);
    expect(saved.id).toBe(id);
    expect(saved.lines[0].unitPrice).toBe('150.00');
    database.close();
    const nextEditor = TestBed.runInInjectionContext(() => new QuoteEditorStore());
    await nextEditor.open(id);
    expect(readQuoteForm(nextEditor.form)).toEqual(saved);
    expect(nextEditor.quote().lines.map((line) => line.id)).toEqual(order);
    expect(nextEditor.saveState()).toBe('saved');
    expect(nextEditor.hasPendingChanges()).toBe(false);
    expect(await repository.findById(id!)).toEqual(saved);
  });

  it('recupera un precio vacío y otros decimales incompletos sin convertirlos ni calcular totales', async () => {
    const id = await store.open(null);
    store.loadExample();
    store.form.controls.lines.at(0).patchValue({
      unitPrice: '',
      discount: { kind: 'percentage', value: '' },
      vat: { rate: '' },
    });
    store.form.controls.lines.at(1).controls.quantity.setValue('2,');
    expect(await store.flush()).toBe(true);
    const saved = readQuoteForm(store.form);
    database.close();
    const recovered = TestBed.runInInjectionContext(() => new QuoteEditorStore());
    await recovered.open(id);
    expect(readQuoteForm(recovered.form)).toEqual(saved);
    expect(recovered.form.controls.lines.at(0).controls.unitPrice.value).toBe('');
    expect(recovered.form.controls.lines.at(1).controls.quantity.value).toBe('2,');
    expect(recovered.calculation().status).not.toBe('valid');
    expect(recovered.hasPendingChanges()).toBe(false);
  });
});
