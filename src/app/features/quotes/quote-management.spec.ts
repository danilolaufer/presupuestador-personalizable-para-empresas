import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { AppDatabase, runTransaction } from '../../core/persistence/app-database';
import { calculateQuote } from '../../domain/quotes/calculate-quote';
import type { DraftQuote, FinalizedQuote } from '../../domain/quotes/quote';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { quoteDates } from '../../domain/quotes/quote-lifecycle';
import { IndexedDbQuoteRepository } from './indexeddb-quote-repository';
import { IndexedDbSettingsRepository } from '../settings/indexeddb-settings-repository';
import { defaultSettings } from '../settings/app-settings';

describe('Gestión, numeración y conservación del histórico en IndexedDB', () => {
  let factory: IDBFactory;
  let name: string;
  let database: AppDatabase;
  let repository: IndexedDbQuoteRepository;
  let secondDatabase: AppDatabase;
  const newQuote = () => ({ ...createReferenceQuote(), id: crypto.randomUUID(), number: '' });
  beforeEach(() => {
    factory = new IDBFactory();
    name = crypto.randomUUID();
    database = new AppDatabase(factory, name);
    secondDatabase = new AppDatabase(factory, name);
    repository = new IndexedDbQuoteRepository(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
    secondDatabase.close();
  });

  it('asigna dos números distintos desde dos conexiones y no los reutiliza tras eliminar', async () => {
    const second = new IndexedDbQuoteRepository(secondDatabase);
    const documents = await Promise.all([repository.create(newQuote()), second.create(newQuote())]);
    const prefix = `P-${new Date().getFullYear()}-`;
    expect(documents.map((item) => item.number).sort()).toEqual([prefix + '0001', prefix + '0002']);
    for (const document of documents) await repository.delete(document.id, document.revision);
    expect((await repository.create(newQuote())).number).toBe(prefix + '0003');
    expect(documents[0].id).not.toBe(documents[1].id);
  });

  it('respeta números anteriores y avanza por encima de los números manuales del año', async () => {
    const legacy = await repository.create({ ...newQuote(), number: 'PERSONAL-ANTERIOR' });
    const prefix = `P-${new Date().getFullYear()}-`;
    await repository.create({ ...newQuote(), number: prefix + '0042' });
    expect((await repository.create(newQuote())).number).toBe(prefix + '0043');
    expect((await repository.findById(legacy.id))?.number).toBe('PERSONAL-ANTERIOR');
  });

  it('rechaza números duplicados al crear o editar, ignorando mayúsculas y espacios exteriores', async () => {
    const first = await repository.create({ ...newQuote(), number: 'MANUAL-7' });
    const second = await repository.create(newQuote());
    await expect(repository.create({ ...newQuote(), number: ' manual-7 ' })).rejects.toMatchObject({
      code: 'duplicate-number',
    });
    await expect(
      repository.save({ ...second, number: 'manual-7' }, second.revision),
    ).rejects.toMatchObject({ code: 'duplicate-number' });
    expect(await repository.findById(second.id)).toEqual(second);
    expect(await repository.findById(first.id)).toEqual(first);
  });

  it('solo una de dos asignaciones manuales concurrentes obtiene el mismo número', async () => {
    const first = await repository.create(newQuote());
    const second = await repository.create(newQuote());
    const results = await Promise.allSettled([
      repository.save({ ...first, number: 'MISMO-NÚMERO' }, 1),
      new IndexedDbQuoteRepository(secondDatabase).save({ ...second, number: 'MISMO-NÚMERO' }, 1),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((item) => item.status === 'rejected')).toMatchObject({
      reason: { code: 'duplicate-number' },
    });
  });

  it('revierte documento y contador si aborta la creación después del éxito de add', async () => {
    const original = FakeObjectStore.prototype.add;
    const spy = vi.spyOn(FakeObjectStore.prototype, 'add').mockImplementationOnce(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      const request = original.call(this, value);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(repository.create(newQuote())).rejects.toBeDefined();
    spy.mockRestore();
    expect(await repository.list()).toEqual([]);
    expect((await repository.create(newQuote())).number).toBe(`P-${new Date().getFullYear()}-0001`);
  });

  it('duplica como borrador independiente con número, fechas y UUID de líneas nuevos', async () => {
    const source = await repository.create(newQuote());
    const copy = await repository.copy(source.id, source.revision, 15, 'duplicate');
    expect(copy).toMatchObject({
      ...quoteDates(15),
      issuer: source.issuer,
      client: source.client,
      brand: source.brand,
      payment: source.payment,
      conditions: source.conditions,
      status: 'draft',
      revision: 1,
    });
    expect(copy.id).not.toBe(source.id);
    expect(copy.number).not.toBe(source.number);
    expect(copy).not.toHaveProperty('revisionOfId');
    copy.lines.forEach((line, index) => {
      expect(line.id).not.toBe(source.lines[index].id);
      expect(line).toEqual({ ...source.lines[index], id: line.id });
    });
    await repository.save(
      {
        ...copy,
        title: 'Copia editada',
        lines: copy.lines.map((line) => ({ ...line, unitPrice: '9.00' })),
      },
      copy.revision,
    );
    expect(await repository.findById(source.id)).toEqual(source);
  });

  it('valida al enviar incluso si se llama directamente al repositorio', async () => {
    const incomplete = newQuote();
    incomplete.lines[0].unitPrice = '';
    const saved = await repository.create(incomplete);
    await expect(repository.changeStatus(saved.id, 1, 'sent')).rejects.toMatchObject({
      code: 'invalid-document',
    });
    await expect(repository.changeStatus(saved.id, 1, 'accepted')).rejects.toMatchObject({
      code: 'invalid-document',
    });
    expect(await repository.findById(saved.id)).toEqual(saved);
  });

  it('congela contenido y totales al enviar, cambia estados y crea una revisión separada', async () => {
    const draft = await repository.create(newQuote());
    const sent = await repository.changeStatus(draft.id, 1, 'sent');
    expect(sent.totals.combined.total).toBe('1845.25');
    expect(sent.calculationVersion).toBe(1);
    await expect(
      repository.save({ ...draft, title: 'Cambio prohibido' }, sent.revision),
    ).rejects.toMatchObject({ code: 'read-only' });
    const accepted = await repository.changeStatus(sent.id, sent.revision, 'accepted');
    expect(accepted).toEqual({
      ...sent,
      status: 'accepted',
      revision: 3,
      updatedAt: accepted.updatedAt,
    });
    const rejected = await repository.changeStatus(sent.id, accepted.revision, 'rejected');
    expect(rejected.totals).toEqual(sent.totals);
    await expect(
      repository.changeStatus(sent.id, rejected.revision, 'draft' as FinalizedQuote['status']),
    ).rejects.toMatchObject({ code: 'invalid-document' });
    const revision = await repository.copy(sent.id, rejected.revision, 45, 'revision');
    expect(revision.revisionOfId).toBe(sent.id);
    expect(revision.status).toBe('draft');
    expect(revision.revision).toBe(1);
    expect(revision.number).not.toBe(sent.number);
    expect(revision).not.toHaveProperty('totals');
    await repository.save({ ...revision, title: 'Nueva propuesta' }, 1);
    expect(await repository.findById(sent.id)).toEqual(rejected);
    await expect(repository.copy(revision.id, 2, 30, 'revision')).rejects.toThrow('cerrados');
  });

  it('protege cambios de estado y copias con la revisión esperada', async () => {
    const draft = await repository.create(newQuote());
    await repository.save({ ...draft, title: 'Otra pestaña' }, 1);
    await expect(repository.changeStatus(draft.id, 1, 'sent')).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(repository.copy(draft.id, 1, 30, 'duplicate')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('configuración y contador coexisten sin sobrescribirse y detectan conflictos de configuración', async () => {
    const settingsRepository = new IndexedDbSettingsRepository(database);
    const settings = await settingsRepository.save(
      { ...defaultSettings(), issuer: { ...defaultSettings().issuer, name: 'Empresa ficticia' } },
      0,
    );
    await repository.create(newQuote());
    expect(await settingsRepository.load()).toEqual(settings);
    await expect(
      new IndexedDbSettingsRepository(secondDatabase).save(defaultSettings(), 0),
    ).rejects.toThrow('Otra pestaña');
    await settingsRepository.save({ ...settings, validityDays: 60 }, 1);
    expect((await repository.create(newQuote())).number).toBe(`P-${new Date().getFullYear()}-0002`);
  });

  it('migra la base de entrega 3 conservando valores, totales, números repetidos y configuración ajena', async () => {
    const {
      title,
      payment: { holder, ...oldPayment },
      ...content
    } = createReferenceQuote();
    const legacy = { ...content, schemaVersion: 1, payment: oldPayment, revision: 7 };
    const calculation = calculateQuote(legacy);
    if (calculation.status !== 'valid') throw new Error('Referencia inválida');
    const closed = {
      ...legacy,
      id: crypto.randomUUID(),
      status: 'sent',
      totals: calculation.totals,
    };
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('quotes', { keyPath: 'id' });
        request.result.createObjectStore('settings', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await runTransaction(oldDatabase, 'quotes', 'readwrite', (store, result) => {
      store.put(legacy);
      store.put(closed);
      result(undefined);
    });
    await runTransaction(oldDatabase, 'settings', 'readwrite', (store, result) => {
      store.put({ id: 'legacy-setting', value: 'Conservar' });
      result(undefined);
    });
    oldDatabase.close();
    const migrated = await repository.findById(legacy.id);
    expect(migrated).toEqual({
      ...legacy,
      schemaVersion: 2,
      title: '',
      payment: { ...oldPayment, holder: '' },
    });
    expect(await repository.findById(closed.id)).toEqual({
      ...closed,
      schemaVersion: 2,
      title: '',
      payment: { ...oldPayment, holder: '' },
    });
    const updated = await repository.save({ ...(migrated as DraftQuote), title: 'Solo título' }, 7);
    expect(updated.number).toBe(legacy.number);
    await expect(
      repository.changeStatus(updated.id, updated.revision, 'sent'),
    ).rejects.toMatchObject({ code: 'duplicate-number' });
    const raw = await runTransaction(
      await database.open(),
      'settings',
      'readonly',
      (store, result) => {
        const request = store.get('legacy-setting');
        request.onsuccess = () => result(request.result);
      },
    );
    expect(raw).toEqual({ id: 'legacy-setting', value: 'Conservar' });
    database.close();
    expect(await repository.findById(updated.id)).toEqual(updated);
  });
});
