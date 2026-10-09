import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../../app.routes';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemoryQuoteRepository } from '../testing/memory-quote-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { QuotePreview } from './quote-preview';
import { QuoteEditor } from '../quote-editor/quote-editor';

describe('Vista previa y guardado al navegar', () => {
  let repository: MemoryQuoteRepository;
  beforeEach(() => {
    repository = new MemoryQuoteRepository();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new MemorySettingsRepository() },
      ],
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('abre desde el editor tras guardar lo pendiente y permite imprimir sin cambiar el estado', async () => {
    const quote = await repository.create(createReferenceQuote());
    const harness = await RouterTestingHarness.create();
    const editor = await harness.navigateByUrl(`/presupuestos/${quote.id}/editar`, QuoteEditor);
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
    editor.form.controls.lines.at(0).controls.quantity.setValue('10');
    await editor.openPreview();
    const preview = harness.routeDebugElement!.componentInstance as QuotePreview;
    await vi.waitFor(() => expect(preview.state()).toBe('ready'));
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('2.208,25 €');
    const stored = await repository.findById(quote.id);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await preview.print();
    expect(print).toHaveBeenCalledOnce();
    expect(await repository.findById(quote.id)).toEqual(stored);
    expect(stored?.status).toBe('draft');
  });

  it('permanece en el editor si no puede guardar antes de abrir la vista previa', async () => {
    const quote = await repository.create(createReferenceQuote());
    const harness = await RouterTestingHarness.create();
    const editor = await harness.navigateByUrl(`/presupuestos/${quote.id}/editar`, QuoteEditor);
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
    editor.form.controls.title.setValue('Cambios locales');
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('Disco lleno'));
    await editor.openPreview();
    expect(TestBed.inject(Router).url).toContain('/editar');
    expect(editor.form.controls.title.value).toBe('Cambios locales');
    expect(editor.actionMessage()).toContain('hasta guardar');
  });

  it('bloquea el botón de imprimir con campos vacíos y muestra qué corregir', async () => {
    const quote = createReferenceQuote();
    quote.lines[0].unitPrice = '';
    await repository.create(quote);
    const harness = await RouterTestingHarness.create();
    const preview = await harness.navigateByUrl(
      `/presupuestos/${quote.id}/vista-previa`,
      QuotePreview,
    );
    await vi.waitFor(() => expect(preview.state()).toBe('ready'));
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain('Servicio 1, Precio');
    expect(harness.routeNativeElement!.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      true,
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await preview.print();
    expect(print).not.toHaveBeenCalled();
  });

  it('distingue documento inexistente de fallo de lectura y permite reintentar', async () => {
    const harness = await RouterTestingHarness.create();
    const preview = await harness.navigateByUrl('/presupuestos/ausente/vista-previa', QuotePreview);
    await vi.waitFor(() => expect(preview.state()).toBe('missing'));
    vi.spyOn(repository, 'findById').mockRejectedValueOnce(new Error('Lectura fallida'));
    await preview.load();
    expect(preview.state()).toBe('error');
    expect(preview.error()).toBe('Lectura fallida');
    await preview.load();
    expect(preview.state()).toBe('missing');
  });
});
