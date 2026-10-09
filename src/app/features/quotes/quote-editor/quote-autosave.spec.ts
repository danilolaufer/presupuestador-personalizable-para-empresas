import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { TestBed } from '@angular/core/testing';
import type { DraftQuote } from '../../../domain/quotes/quote';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import { QUOTE_REPOSITORY, QuoteRepositoryError } from '../quote-repository';
import { deferred, MemoryQuoteRepository } from '../testing/memory-quote-repository';
import { QuoteEditorStore } from './quote-editor-store';
import { readQuoteForm } from './quote-form';

describe('Carga, autoguardado y concurrencia del coordinador', () => {
  let repository: MemoryQuoteRepository;
  let store: QuoteEditorStore;

  beforeEach(() => {
    vi.useFakeTimers();
    repository = new MemoryQuoteRepository();
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('no guarda el formulario vacío mientras está cargando ni al aplicar el documento', async () => {
    const saved = await repository.create(createReferenceQuote());
    const gate = deferred<DraftQuote>();
    vi.spyOn(repository, 'findById').mockReturnValueOnce(gate.promise);
    const save = vi.spyOn(repository, 'save');
    const opening = store.open(saved.id);
    expect(store.form.disabled).toBe(true);
    expect(store.loadState()).toBe('loading');
    store.form.controls.number.setValue('Valor inicial que no debe persistirse');
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    gate.resolve(saved);
    await opening;
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(readQuoteForm(store.form)).toEqual(saved);
    expect(store.saveState()).toBe('saved');
    expect(store.hasPendingChanges()).toBe(false);
  });

  it('distingue inexistencia, error de lectura y documento cerrado sin crear otro encima', async () => {
    const create = vi.spyOn(repository, 'create');
    await store.open('inexistente');
    expect(store.loadState()).toBe('not-found');
    vi.spyOn(repository, 'findById').mockRejectedValueOnce(new Error('Error de lectura'));
    await store.open('inexistente');
    expect(store.loadState()).toBe('load-error');
    expect(store.loadError()).toContain('No se pudo leer');
    const saved = { ...createReferenceQuote(), revision: 1 };
    const calculation = calculateQuote(saved);
    if (calculation.status !== 'valid') throw new Error('La referencia debe calcularse.');
    repository.documents.set(saved.id, { ...saved, status: 'sent', totals: calculation.totals });
    await store.open(saved.id);
    expect(store.loadState()).toBe('read-only');
    expect(create).not.toHaveBeenCalled();
    expect(store.addLine()).toBeUndefined();
  });

  it('agrupa cambios rápidos con 500 ms desde la última edición y conserva el campo vacío', async () => {
    await store.open(null);
    const save = vi.spyOn(repository, 'save');
    store.loadExample();
    await vi.advanceTimersByTimeAsync(300);
    store.form.controls.lines.at(0).controls.quantity.setValue('10');
    await vi.advanceTimersByTimeAsync(300);
    store.form.controls.lines.at(0).controls.unitPrice.setValue('');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    expect(store.saveState()).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].lines[0]).toMatchObject({ quantity: '10', unitPrice: '' });
    expect(store.saveState()).toBe('saved');
    expect(store.calculation().status).toBe('incomplete');
    expect(store.hasPendingChanges()).toBe(false);
    expect(store.quote().revision).toBe(2);
  });

  it('serializa escrituras y no muestra Guardado mientras haya una edición posterior pendiente', async () => {
    await store.open(null);
    const first = deferred<void>();
    const second = deferred<void>();
    const saveReal = repository.save.bind(repository);
    const save = vi
      .spyOn(repository, 'save')
      .mockImplementationOnce(async (quote, revision) => {
        await first.promise;
        return saveReal(quote, revision);
      })
      .mockImplementationOnce(async (quote, revision) => {
        await second.promise;
        return saveReal(quote, revision);
      });
    store.loadExample();
    await vi.advanceTimersByTimeAsync(500);
    expect(store.saveState()).toBe('saving');
    store.form.controls.lines.at(0).controls.quantity.setValue('10');
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toBe(2);
    expect(save.mock.calls[1][0].lines[0].quantity).toBe('10');
    expect(store.form.controls.lines.at(0).controls.quantity.value).toBe('10');
    expect(store.saveState()).toBe('saving');
    expect(store.hasPendingChanges()).toBe(true);
    second.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saveState()).toBe('saved');
    expect(store.hasPendingChanges()).toBe(false);
    expect(store.quote().revision).toBe(3);
    expect(repository.documents.get(store.quote().id)?.lines[0].quantity).toBe('10');
  });

  it('respeta el debounce de una nueva edición si la escritura anterior termina antes', async () => {
    await store.open(null);
    const gate = deferred<void>();
    const saveReal = repository.save.bind(repository);
    const save = vi.spyOn(repository, 'save').mockImplementationOnce(async (quote, revision) => {
      await gate.promise;
      return saveReal(quote, revision);
    });
    store.loadExample();
    await vi.advanceTimersByTimeAsync(500);
    store.form.controls.number.setValue('ÚLTIMA EDICIÓN');
    gate.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.saveState()).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(499);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.saveState()).toBe('saved');
  });

  it('conserva ediciones tras un fallo y solo reintenta al pedirlo explícitamente', async () => {
    await store.open(null);
    const save = vi
      .spyOn(repository, 'save')
      .mockRejectedValueOnce(new DOMException('Sin espacio', 'QuotaExceededError'));
    store.loadExample();
    await vi.advanceTimersByTimeAsync(500);
    expect(store.saveState()).toBe('error');
    expect(store.saveError()).toContain('No queda espacio');
    store.form.controls.conditions.controls.notes.setValue('Cambios posteriores al error');
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.hasPendingChanges()).toBe(true);
    expect(await store.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(repository.documents.get(store.quote().id)?.conditions.notes).toBe(
      'Cambios posteriores al error',
    );
  });

  it('flush comparte la escritura en curso y espera también las ediciones que llegan al salir', async () => {
    await store.open(null);
    const gate = deferred<void>();
    const saveReal = repository.save.bind(repository);
    const save = vi.spyOn(repository, 'save').mockImplementationOnce(async (quote, revision) => {
      await gate.promise;
      return saveReal(quote, revision);
    });
    store.loadExample();
    const leaving = store.flush();
    expect(store.flush()).toBe(leaving);
    store.form.controls.number.setValue('EDICIÓN DURANTE SALIDA');
    gate.resolve(undefined);
    expect(await leaving).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(repository.documents.get(store.quote().id)?.number).toBe('EDICIÓN DURANTE SALIDA');
    expect(store.hasPendingChanges()).toBe(false);
  });

  it('detecta el conflicto, conserva el borrador y no reintenta la revisión antigua en silencio', async () => {
    const saved = await repository.create(createReferenceQuote());
    await store.open(saved.id);
    const second = TestBed.runInInjectionContext(() => new QuoteEditorStore());
    await second.open(saved.id);
    store.form.controls.number.setValue('PESTAÑA A');
    expect(await store.flush()).toBe(true);
    second.form.controls.number.setValue('PESTAÑA B');
    expect(await second.flush()).toBe(false);
    expect(second.saveState()).toBe('conflict');
    expect(second.form.controls.number.value).toBe('PESTAÑA B');
    const save = vi.spyOn(repository, 'save');
    second.form.controls.conditions.controls.notes.setValue('Mi cambio local');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second.flush()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(repository.documents.get(saved.id)?.number).toBe('PESTAÑA A');
  });

  it('un fallo al recargar un conflicto conserva todos los cambios locales hasta poder cargar la versión almacenada', async () => {
    const saved = await repository.create(createReferenceQuote());
    await store.open(saved.id);
    store.form.controls.number.setValue('LOCAL');
    await repository.save({ ...saved, number: 'REMOTO' }, 1);
    expect(await store.flush()).toBe(false);
    const before = readQuoteForm(store.form);
    vi.spyOn(repository, 'findById').mockRejectedValueOnce(new Error('Lectura fallida'));
    expect(await store.reloadStored()).toBe(false);
    expect(readQuoteForm(store.form)).toEqual(before);
    expect(store.hasPendingChanges()).toBe(true);
    expect(store.saveState()).toBe('conflict');
    expect(await store.reloadStored()).toBe(true);
    expect(store.form.controls.number.value).toBe('REMOTO');
    expect(store.hasPendingChanges()).toBe(false);
    expect(store.saveState()).toBe('saved');
    store.form.controls.number.setValue('NUEVA EDICIÓN SOBRE REMOTO');
    expect(await store.flush()).toBe(true);
    expect(store.quote().revision).toBe(3);
  });

  it('tras fallar la creación permite editar y reintenta el mismo ID sin perder el formulario', async () => {
    const id = store.form.controls.metadata.value.id;
    const create = vi
      .spyOn(repository, 'create')
      .mockRejectedValueOnce(new Error('Creación fallida'));
    await store.open(null);
    expect(store.loadState()).toBe('ready');
    expect(store.saveState()).toBe('error');
    store.form.controls.number.setValue('BORRADOR LOCAL');
    store.addLine();
    expect(await store.flush()).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(repository.documents.get(id)?.number).toBe('BORRADOR LOCAL');
    expect(repository.documents.get(id)?.lines[0].unitPrice).toBe('');
    expect(store.quote().id).toBe(id);
  });

  it('ignora respuestas de una carga anterior que llega después de otra dirección', async () => {
    const first = {
      ...createReferenceQuote(),
      id: crypto.randomUUID(),
      revision: 1,
      number: 'ANTERIOR',
    };
    const latest = {
      ...createReferenceQuote(),
      id: crypto.randomUUID(),
      revision: 1,
      number: 'ACTUAL',
    };
    repository.documents.set(latest.id, latest);
    const gate = deferred<DraftQuote>();
    vi.spyOn(repository, 'findById').mockReturnValueOnce(gate.promise);
    const opening = store.open(first.id);
    await store.open(latest.id);
    gate.resolve(first);
    await opening;
    expect(store.quote().number).toBe('ACTUAL');
    expect(store.hasPendingChanges()).toBe(false);
  });

  it('cancela el debounce al destruir el coordinador', async () => {
    await store.open(null);
    const save = vi.spyOn(repository, 'save');
    store.loadExample();
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
