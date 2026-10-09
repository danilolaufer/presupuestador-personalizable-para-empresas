import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../app.routes';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { deferred, MemoryQuoteRepository } from '../testing/memory-quote-repository';
import { QuoteEditor } from './quote-editor';

describe('Identidad y navegación del editor con el Router de Angular', () => {
  let repository: MemoryQuoteRepository;
  let router: Router;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    repository = new MemoryQuoteRepository();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useClass: MemorySettingsRepository },
      ],
    });
    router = TestBed.inject(Router);
    harness = await RouterTestingHarness.create();
  });
  afterEach(() => vi.restoreAllMocks());

  async function openExisting() {
    const saved = await repository.create(createReferenceQuote());
    const editor = await harness.navigateByUrl(`/presupuestos/${saved.id}/editar`, QuoteEditor);
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
    return { editor, saved };
  }

  it('persiste antes de navegar de nuevo a la dirección con ID y recupera ese mismo documento', async () => {
    const gate = deferred<void>();
    const createReal = repository.create.bind(repository);
    vi.spyOn(repository, 'create').mockImplementationOnce(async (quote) => {
      await gate.promise;
      return createReal(quote);
    });
    const editor = await harness.navigateByUrl('/presupuestos/nuevo', QuoteEditor);
    expect(editor.store.loadState()).toBe('loading');
    expect(router.url).toBe('/presupuestos/nuevo');
    expect(repository.documents.size).toBe(0);
    const id = editor.form.controls.metadata.value.id;
    gate.resolve(undefined);
    await vi.waitFor(() => expect(router.url).toBe(`/presupuestos/${id}/editar`));
    expect(repository.documents.has(id)).toBe(true);
    await vi.waitFor(() =>
      expect(harness.routeNativeElement?.textContent).toContain('Guardado a las'),
    );
    expect(repository.documents.size).toBe(1);
  });

  it('espera la escritura y las ediciones que llegan durante ella antes de salir', async () => {
    const { editor, saved } = await openExisting();
    const gate = deferred<void>();
    const saveReal = repository.save.bind(repository);
    const save = vi.spyOn(repository, 'save').mockImplementationOnce(async (quote, revision) => {
      await gate.promise;
      return saveReal(quote, revision);
    });
    editor.form.controls.number.setValue('AL SALIR');
    const navigation = router.navigateByUrl('/configuracion');
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(router.url).toBe(`/presupuestos/${saved.id}/editar`);
    editor.form.controls.conditions.controls.notes.setValue('Edición durante escritura');
    gate.resolve(undefined);
    expect(await navigation).toBe(true);
    expect(router.url).toBe('/configuracion');
    expect(repository.documents.get(saved.id)).toMatchObject({
      number: 'AL SALIR',
      conditions: { notes: 'Edición durante escritura' },
      revision: 3,
    });
  });

  it('permite quedarse cuando falla el guardado, conservando ruta, formulario y aviso de recarga', async () => {
    const { editor, saved } = await openExisting();
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('Fallo simulado'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    editor.form.controls.number.setValue('NO PERDER');
    expect(await router.navigateByUrl('/configuracion')).toBe(false);
    expect(router.url).toBe(`/presupuestos/${saved.id}/editar`);
    expect(editor.form.controls.number.value).toBe('NO PERDER');
    expect(editor.store.saveState()).toBe('error');
    const event = new Event('beforeunload', { cancelable: true });
    editor.beforeUnload(event as BeforeUnloadEvent);
    expect(event.defaultPrevented).toBe(true);
  });

  it('protege también el cambio de ID cuando Angular reutiliza el componente', async () => {
    const { editor, saved } = await openExisting();
    const other = await repository.create({
      ...createReferenceQuote(),
      id: crypto.randomUUID(),
      number: 'OTRO',
    });
    editor.form.controls.number.setValue('PRIMERO EDITADO');
    expect(await router.navigateByUrl(`/presupuestos/${other.id}/editar`)).toBe(true);
    await vi.waitFor(() => expect(editor.form.controls.number.value).toBe('OTRO'));
    expect(repository.documents.get(saved.id)?.number).toBe('PRIMERO EDITADO');
    editor.form.controls.number.setValue('OTRO LOCAL');
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('Fallo simulado'));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await router.navigateByUrl(`/presupuestos/${saved.id}/editar`)).toBe(false);
    expect(editor.form.controls.number.value).toBe('OTRO LOCAL');
    expect(router.url).toBe(`/presupuestos/${other.id}/editar`);
  });

  it('presenta mensajes distintos para documento inexistente y lectura fallida, con reintento', async () => {
    const editor = await harness.navigateByUrl('/presupuestos/ausente/editar', QuoteEditor);
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('not-found'));
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('No existe');
    vi.spyOn(repository, 'findById').mockRejectedValueOnce(new Error('Lectura fallida'));
    editor.retryLoad();
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('load-error'));
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Reintentar carga');
    expect(repository.documents.size).toBe(0);
    editor.retryLoad();
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('not-found'));
  });

  it('abre el nuevo ID si se acepta explícitamente salir perdiendo los cambios locales', async () => {
    const { editor, saved } = await openExisting();
    const other = await repository.create({
      ...createReferenceQuote(),
      id: crypto.randomUUID(),
      number: 'DESTINO',
    });
    editor.form.controls.number.setValue('DESCARTAR SOLO TRAS CONFIRMAR');
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('Fallo simulado'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await router.navigateByUrl(`/presupuestos/${other.id}/editar`)).toBe(true);
    await vi.waitFor(() => expect(editor.form.controls.number.value).toBe('DESTINO'));
    expect(editor.store.hasPendingChanges()).toBe(false);
    expect(repository.documents.get(saved.id)?.number).toBe(saved.number);
  });
});
