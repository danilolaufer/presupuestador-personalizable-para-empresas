import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import {
  AppDatabase,
  APP_DATABASE_VERSION,
  runTransaction,
} from '../../core/persistence/app-database';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { calculateQuote } from '../../domain/quotes/calculate-quote';
import { IndexedDbQuoteRepository } from './indexeddb-quote-repository';

describe('Repositorio IndexedDB con transacciones', () => {
  let factory: IDBFactory;
  let database: AppDatabase;
  let repository: IndexedDbQuoteRepository;
  let databaseName: string;

  beforeEach(() => {
    factory = new IDBFactory();
    databaseName = `test-${crypto.randomUUID()}`;
    database = new AppDatabase(factory, databaseName);
    repository = new IndexedDbQuoteRepository(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it('crea los almacenes quotes y settings con una versión física independiente', async () => {
    const db = await database.open();
    expect(db.version).toBe(APP_DATABASE_VERSION);
    expect([...db.objectStoreNames]).toEqual(['quotes', 'settings']);
    expect(await database.open()).toBe(db);
  });

  it('recupera el documento completo y los decimales como texto después de cerrar y reabrir la conexión', async () => {
    const quote = createReferenceQuote();
    quote.brand.logoDataUrl = 'data:image/png;base64,AA==';
    quote.conditions.notes = 'Observaciones ficticias\nSegunda línea';
    quote.payment.iban = 'IBAN-FICTICIO';
    quote.lines[0].sourceServiceId = 'servicio-ficticio';
    const saved = await repository.create(quote);
    database.close();
    expect(await repository.findById(quote.id)).toEqual(saved);
    expect(saved.revision).toBe(1);
    expect(saved.lines[0].unitPrice).toBe('150.00');
    expect(quote.revision).toBe(0);
  });

  it('guarda borradores incompletos, texto inválido y el orden de las líneas sin convertirlos en cero', async () => {
    const quote = await repository.create(createReferenceQuote());
    quote.lines[0].unitPrice = '';
    quote.lines[1].quantity = '2,';
    quote.lines = [quote.lines[2], quote.lines[0], quote.lines[1]];
    quote.number = '';
    const saved = await repository.save(quote, 1);
    expect(await repository.findById(quote.id)).toEqual(saved);
    expect(saved.lines.map((line) => line.id)).toEqual(quote.lines.map((line) => line.id));
    expect(saved.lines[1].unitPrice).toBe('');
    expect(saved.lines[2].quantity).toBe('2,');
    expect(saved.revision).toBe(2);
  });

  it('rechaza crear el mismo ID sin sobrescribir lo existente', async () => {
    const saved = await repository.create(createReferenceQuote());
    const changed = { ...saved, number: 'OTRO' };
    await expect(repository.create(changed)).rejects.toMatchObject({ code: 'conflict' });
    expect(await repository.findById(saved.id)).toEqual(saved);
  });

  it('comprueba la revisión y escribe atómicamente entre dos conexiones', async () => {
    const secondDatabase = new AppDatabase(factory, databaseName);
    const second = new IndexedDbQuoteRepository(secondDatabase);
    try {
      const saved = await repository.create(createReferenceQuote());
      const results = await Promise.allSettled([
        repository.save({ ...saved, number: 'PESTAÑA-A' }, 1),
        second.save({ ...saved, number: 'PESTAÑA-B' }, 1),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
      const winner = results.find((result) => result.status === 'fulfilled');
      if (winner?.status !== 'fulfilled') throw new Error('Falta la escritura confirmada.');
      expect(await repository.findById(saved.id)).toEqual(winner.value);
      expect(winner.value.revision).toBe(2);
    } finally {
      secondDatabase.close();
    }
  });

  it('no confirma un guardado si la transacción aborta después del éxito de put', async () => {
    const saved = await repository.create(createReferenceQuote());
    const originalPut = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      const request = originalPut.call(this, value);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(repository.save({ ...saved, number: 'NO CONFIRMADO' }, 1)).rejects.toBeDefined();
    expect(await repository.findById(saved.id)).toEqual(saved);
  });

  it('conserva el documento anterior cuando falla una escritura por falta de espacio', async () => {
    const saved = await repository.create(createReferenceQuote());
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Fallo simulado', 'QuotaExceededError');
    });
    await expect(repository.save({ ...saved, number: 'PENDIENTE' }, 1)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(await repository.findById(saved.id)).toEqual(saved);
  });

  it('distingue un ID inexistente de un fallo al leer', async () => {
    expect(await repository.findById('inexistente')).toBeNull();
    vi.spyOn(FakeObjectStore.prototype, 'get').mockImplementationOnce(() => {
      throw new DOMException('Lectura fallida', 'InvalidStateError');
    });
    await expect(repository.findById('inexistente')).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });

  it('no resucita un documento eliminado y protege la eliminación frente a revisiones antiguas', async () => {
    const saved = await repository.create(createReferenceQuote());
    await expect(repository.delete(saved.id, 0)).rejects.toMatchObject({ code: 'conflict' });
    expect(await repository.list()).toEqual([saved]);
    await repository.delete(saved.id, 1);
    expect(await repository.findById(saved.id)).toBeNull();
    await expect(repository.save(saved, 1)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rechaza estructuras/versiones incompatibles sin reinicializar ni borrar la base', async () => {
    const saved = await repository.create(createReferenceQuote());
    const db = await database.open();
    const incompatible = { ...saved, schemaVersion: 999 };
    await runTransaction(db, 'quotes', 'readwrite', (store, result) => {
      store.put(incompatible);
      result(undefined);
    });
    await expect(repository.findById(saved.id)).rejects.toMatchObject({
      code: 'unsupported-document',
    });
    const raw = await runTransaction(db, 'quotes', 'readonly', (store, result) => {
      const request = store.get(saved.id);
      request.onsuccess = () => result(request.result);
    });
    expect(raw).toEqual(incompatible);
    expect(db.version).toBe(APP_DATABASE_VERSION);
  });

  it('no cambia el contenido de un presupuesto enviado', async () => {
    const saved = await repository.create(createReferenceQuote());
    const calculation = calculateQuote(saved);
    if (calculation.status !== 'valid') throw new Error('La referencia debe calcularse.');
    const closed = { ...saved, status: 'sent', totals: calculation.totals };
    await runTransaction(await database.open(), 'quotes', 'readwrite', (store, result) => {
      store.put(closed);
      result(undefined);
    });
    await expect(repository.save(saved, 1)).rejects.toMatchObject({ code: 'read-only' });
    expect(await repository.findById(saved.id)).toEqual(closed);
  });

  it('conserva settings al guardar y eliminar presupuestos', async () => {
    const settings = { id: 'app', label: 'Configuración ficticia' };
    await runTransaction(await database.open(), 'settings', 'readwrite', (store, result) => {
      store.put(settings);
      result(undefined);
    });
    const saved = await repository.create(createReferenceQuote());
    await repository.delete(saved.id, 1);
    const restored = await runTransaction(
      await database.open(),
      'settings',
      'readonly',
      (store, result) => {
        const request = store.get('app');
        request.onsuccess = () => result(request.result);
      },
    );
    expect(restored).toEqual(settings);
  });

  it('informa de la ausencia de IndexedDB y permite reintentar una apertura fallida', async () => {
    await expect(new AppDatabase(undefined, databaseName).open()).rejects.toThrow(
      'no está disponible',
    );
    vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      throw new DOMException('Acceso denegado', 'SecurityError');
    });
    await expect(database.open()).rejects.toMatchObject({ name: 'SecurityError' });
    expect((await database.open()).version).toBe(APP_DATABASE_VERSION);
  });
});
