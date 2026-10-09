import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb';
import { AppDatabase, runTransaction } from '../persistence/app-database';
import { BackupService, type ImportReview } from './backup-service';
import { parseBackup, type BackupFile } from './backup-format';
import { serializeEmergencyQuote } from './emergency-quote-backup';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { IndexedDbQuoteRepository } from '../../features/quotes/indexeddb-quote-repository';
import { IndexedDbSettingsRepository } from '../../features/settings/indexeddb-settings-repository';
import { defaultSettings } from '../../features/settings/app-settings';
import type { DraftQuote, FinalizedQuote } from '../../domain/quotes/quote';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const choices = (review: ImportReview) =>
  Object.fromEntries(review.rows.map((row) => [row.quote.id, row.choice]));
const fresh = (): DraftQuote => ({
  ...createReferenceQuote(),
  id: crypto.randomUUID(),
  number: '',
});

describe('Copias y restauración transaccional en bases aisladas', () => {
  let sourceDb: AppDatabase;
  let targetDb: AppDatabase;
  let source: BackupService;
  let target: BackupService;
  let sourceQuotes: IndexedDbQuoteRepository;
  let targetQuotes: IndexedDbQuoteRepository;
  let checkImage: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
  beforeEach(() => {
    const factory = new IDBFactory();
    sourceDb = new AppDatabase(factory, 'backup-source-' + crypto.randomUUID());
    targetDb = new AppDatabase(factory, 'backup-target-' + crypto.randomUUID());
    checkImage = vi.fn(async () => {});
    source = new BackupService(sourceDb, checkImage);
    target = new BackupService(targetDb, checkImage);
    sourceQuotes = new IndexedDbQuoteRepository(sourceDb);
    targetQuotes = new IndexedDbQuoteRepository(targetDb);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sourceDb.close();
    targetDb.close();
  });

  async function fixture(): Promise<BackupFile> {
    const reference = fresh();
    reference.brand.logoDataUrl = png;
    const draft = await sourceQuotes.create(reference);
    const sent = await sourceQuotes.changeStatus(draft.id, 1, 'sent');
    const revision = await sourceQuotes.copy(sent.id, sent.revision, 30, 'revision');
    revision.lines[0].unitPrice = '';
    revision.lines[1].quantity = '2,';
    revision.lines = [...revision.lines].reverse();
    await sourceQuotes.save(revision, revision.revision);
    const settings = defaultSettings();
    settings.brand.logoDataUrl = png;
    settings.issuer = reference.issuer;
    settings.catalog = reference.lines.map((line) => ({
      id: line.id,
      name: line.name,
      description: line.description,
      unit: line.unit,
      unitPrice: line.unitPrice,
      frequency: line.frequency,
      vat: line.vat,
    }));
    await new IndexedDbSettingsRepository(sourceDb).save(settings, 0);
    return source.export();
  }

  it('exporta ambas tiendas coherentemente y restaura documentos, orden, vacíos, histórico, logo, catálogo y relaciones en otra base vacía', async () => {
    const backup = await fixture();
    const review = await target.review(JSON.stringify(backup));
    expect(await targetQuotes.list()).toEqual([]); // Revisar no escribe.
    expect(await target.restore(review, choices(review), true)).toBe(2);
    expect(await targetQuotes.list()).toEqual(backup.quotes);
    const settings = await new IndexedDbSettingsRepository(targetDb).load();
    expect(settings).toEqual({ ...backup.settings, revision: 2, updatedAt: settings.updatedAt });
    expect(checkImage).toHaveBeenCalledWith(png);
    targetDb.close();
    expect(await targetQuotes.list()).toEqual(backup.quotes);
    const sent = backup.quotes.find((quote) => quote.status === 'sent') as FinalizedQuote;
    expect(sent.totals).toMatchObject({
      combined: { base: '1525.00', vat: '320.25', total: '1845.25' },
      monthly: { total: '1609.30' },
      oneTime: { total: '235.95' },
    });
    expect((await targetQuotes.create(fresh())).number).toMatch(/0003$/);
  });

  it('conserva ajenos y configuración por defecto, y omite colisiones de ID y número sin tocar emitidos', async () => {
    const backup = await fixture();
    const first = await target.review(JSON.stringify(backup));
    await target.restore(first, choices(first), false);
    const unrelated = await targetQuotes.create({ ...fresh(), number: 'AJENO' });
    const before = await targetQuotes.list();
    const review = await target.review(JSON.stringify(backup));
    expect(review.rows.every((row) => row.choice === 'skip')).toBe(true);
    expect(await target.restore(review, choices(review), false)).toBe(0);
    expect(await targetQuotes.list()).toEqual(before);
    expect(await targetQuotes.findById(unrelated.id)).toEqual(unrelated);
    expect((await new IndexedDbSettingsRepository(targetDb).load()).revision).toBe(0);
  });

  it('detecta un número repetido con ID diferente y permite rescatarlo como borrador independiente', async () => {
    const original = await targetQuotes.create(fresh());
    await sourceQuotes.create({ ...fresh(), number: original.number });
    const review = await target.review(JSON.stringify(await source.export()));
    expect(review.rows[0]).toMatchObject({
      choice: 'skip',
      reason: expect.stringContaining('número'),
    });
    await target.restore(review, { [review.rows[0].quote.id]: 'copy' }, false);
    const documents = await targetQuotes.list();
    expect(documents).toHaveLength(2);
    const copy = documents.find((quote) => quote.id !== original.id)!;
    expect(copy.status).toBe('draft');
    expect(copy.number).not.toBe(original.number);
    expect(copy.lines[0].id).not.toBe(review.rows[0].quote.lines[0].id);
    expect(copy).not.toHaveProperty('totals');
    expect(copy).not.toHaveProperty('revisionOfId');
    expect(await targetQuotes.findById(original.id)).toEqual(original);
  });

  it('no crea enlaces de revisión hacia una versión distinta con el mismo ID', async () => {
    const backup = await fixture();
    const parent = backup.quotes.find((quote) => quote.status === 'sent')!;
    const other = await targetQuotes.create({ ...fresh(), id: parent.id, title: 'Otro contenido' });
    await targetQuotes.changeStatus(other.id, other.revision, 'sent');
    const review = await target.review(JSON.stringify(backup));
    expect(review.rows.every((row) => row.choice === 'skip')).toBe(true);
    const child = backup.quotes.find((quote) => !!quote.revisionOfId)!;
    await expect(
      target.restore(review, { ...choices(review), [child.id]: 'restore' }, false),
    ).rejects.toThrow('origen');
    expect(await targetQuotes.list()).toHaveLength(1);
  });

  it('resuelve números repetidos dentro del propio archivo sin duplicarlos', async () => {
    const first = await sourceQuotes.create(fresh());
    const backup = await source.export();
    backup.quotes.push({ ...first, id: crypto.randomUUID() });
    const review = await target.review(JSON.stringify(backup));
    expect(review.rows.map((row) => row.choice)).toEqual(['restore', 'skip']);
    await target.restore(review, choices(review), false);
    expect(await targetQuotes.list()).toHaveLength(1);
  });

  it('revalida cambios de otra pestaña al confirmar y conserva toda la base', async () => {
    const backup = await fixture();
    const review = await target.review(JSON.stringify(backup));
    const other = await targetQuotes.create(fresh());
    await expect(target.restore(review, choices(review), true)).rejects.toThrow('cambiaron');
    expect(await targetQuotes.list()).toEqual([other]);
    expect((await new IndexedDbSettingsRepository(targetDb).load()).revision).toBe(0);
    const refreshed = await target.review(JSON.stringify(backup));
    expect(refreshed.rows.some((row) => row.reason.includes('número'))).toBe(true);
  });

  it('detecta también una configuración cambiada durante la revisión', async () => {
    const backup = await fixture();
    const review = await target.review(JSON.stringify(backup));
    const saved = await new IndexedDbSettingsRepository(targetDb).save(defaultSettings(), 0);
    await expect(target.restore(review, choices(review), true)).rejects.toThrow('cambiaron');
    expect(await targetQuotes.list()).toEqual([]);
    expect(await new IndexedDbSettingsRepository(targetDb).load()).toEqual(saved);
  });

  it('revierte documentos, configuración y contadores al abortar tras una escritura exitosa', async () => {
    const backup = await fixture();
    const review = await target.review(JSON.stringify(backup));
    const original = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      value: unknown,
    ) {
      const request = original.call(this, value);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(target.restore(review, choices(review), true)).rejects.toBeDefined();
    expect(await targetQuotes.list()).toEqual([]);
    const exported = await target.export();
    expect(exported.settings).toBeNull();
    expect(exported.counters).toEqual([]);
  });

  it('no reduce contadores reservados ni modifica registros ajenos de settings', async () => {
    await sourceQuotes.create(fresh());
    const backup = await source.export();
    const db = await targetDb.open();
    await runTransaction(db, 'settings', 'readwrite', (store, result) => {
      store.put({ id: `quote-sequence-${new Date().getFullYear()}`, lastNumber: 90 });
      store.put({ id: 'ajeno', value: 'intacto' });
      result(undefined);
    });
    const review = await target.review(JSON.stringify(backup));
    await target.restore(review, choices(review), false);
    expect((await targetQuotes.create(fresh())).number).toMatch(/0091$/);
    const foreign = await runTransaction(db, 'settings', 'readonly', (store, result) => {
      const request = store.get('ajeno');
      request.onsuccess = () => result(request.result);
    });
    expect(foreign).toEqual({ id: 'ajeno', value: 'intacto' });
  });

  it('acepta JSON de emergencia actual y de entrega 3, incluso una creación fallida', async () => {
    const quote = createReferenceQuote();
    quote.lines[0].unitPrice = '';
    const parsed = parseBackup(serializeEmergencyQuote(quote));
    expect(parsed.quotes[0]).toMatchObject({ revision: 1, schemaVersion: 2 });
    const {
      title,
      payment: { holder, ...payment },
      ...rest
    } = quote;
    const text = JSON.stringify({
      kind: 'presupuestador-emergency',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      quote: { ...rest, schemaVersion: 1, payment },
    });
    const review = await target.review(text);
    await target.restore(review, choices(review), false);
    expect(await targetQuotes.findById(quote.id)).toMatchObject({
      title: '',
      payment: { holder: '' },
      lines: [{ unitPrice: '' }, {}, {}],
    });
  });

  it('mantiene la base intacta al cancelar la revisión o al fallar la decodificación de una imagen', async () => {
    const backup = await fixture();
    const original = await targetQuotes.create({ ...fresh(), number: 'ORIGINAL' });
    await target.review(JSON.stringify(backup)); // El usuario cancela: no se llama a restore.
    expect(await targetQuotes.list()).toEqual([original]);
    checkImage.mockRejectedValueOnce(new Error('Imagen dañada'));
    await expect(target.review(JSON.stringify(backup))).rejects.toThrow('Imagen dañada');
    expect(await targetQuotes.list()).toEqual([original]);
  });

  it('admite tipos de IVA equivalentes normalizados sin alterar los totales históricos', async () => {
    const quote = fresh();
    quote.lines[0].vat = { kind: 'taxed', rate: '21.00' };
    const created = await sourceQuotes.create(quote);
    const sent = await sourceQuotes.changeStatus(created.id, 1, 'sent');
    const review = await target.review(JSON.stringify(await source.export()));
    await target.restore(review, choices(review), false);
    expect(await targetQuotes.findById(sent.id)).toEqual(sent);
  });

  it.each([
    [
      'versión',
      (backup: BackupFile) => {
        (backup as unknown as { schemaVersion: number }).schemaVersion = 99;
      },
    ],
    [
      'decimal numérico',
      (backup: BackupFile) => {
        (backup.quotes[0].lines[0] as unknown as { unitPrice: number }).unitPrice = 150;
      },
    ],
    [
      'decimal corrupto',
      (backup: BackupFile) => {
        backup.quotes[0].lines[0].unitPrice = 'NaN';
      },
    ],
    [
      'identificador',
      (backup: BackupFile) => {
        backup.quotes[0].id = '../incorrecto';
      },
    ],
    [
      'ID repetido',
      (backup: BackupFile) => {
        backup.quotes.push(backup.quotes[0]);
      },
    ],
    [
      'logo remoto',
      (backup: BackupFile) => {
        backup.quotes[0].brand.logoDataUrl = 'https://example.com/logo.png';
      },
    ],
    [
      'totales',
      (backup: BackupFile) => {
        const sent = backup.quotes.find((quote) => quote.status !== 'draft') as FinalizedQuote;
        sent.totals.combined.total = '1.00';
      },
    ],
    [
      'ciclo',
      (backup: BackupFile) => {
        backup.quotes[0].revisionOfId = backup.quotes[0].id;
      },
    ],
    [
      'tamaño',
      (backup: BackupFile) => {
        backup.quotes[0].title = 'x'.repeat(200001);
      },
    ],
  ])('rechaza %s antes de modificar datos', async (_, corrupt) => {
    const backup = await fixture();
    corrupt(backup);
    await expect(target.review(JSON.stringify(backup))).rejects.toThrow();
    expect(await targetQuotes.list()).toEqual([]);
    expect((await target.export()).settings).toBeNull();
  });

  it('rechaza JSON roto con un mensaje comprensible', async () => {
    await expect(target.review('{ roto')).rejects.toThrow('JSON válido');
  });
});
