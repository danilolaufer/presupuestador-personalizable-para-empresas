import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { changeQuoteStatus } from '../../../domain/quotes/quote-lifecycle';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { MemoryQuoteRepository } from '../testing/memory-quote-repository';
import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { QuoteList } from './quote-list';

describe('Listado de presupuestos en el DOM', () => {
  let repository: MemoryQuoteRepository;
  let fixture: ComponentFixture<QuoteList>;
  let component: QuoteList;
  let element: HTMLElement;
  beforeEach(async () => {
    repository = new MemoryQuoteRepository();
    TestBed.configureTestingModule({
      imports: [QuoteList],
      providers: [
        provideRouter([]),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useClass: MemorySettingsRepository },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(QuoteList);
    component = fixture.componentInstance;
    element = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const dialog = element.querySelector('dialog')!;
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
  });
  afterEach(() => vi.restoreAllMocks());
  async function reload() {
    await component.load();
    fixture.detectChanges();
  }

  it('muestra lista vacía, importes separados, título, datos y cálculo incompleto', async () => {
    expect(element.textContent).toContain('Todavía no hay presupuestos');
    const valid = await repository.create(createReferenceQuote());
    const incomplete = {
      ...createReferenceQuote(),
      id: crypto.randomUUID(),
      number: 'BORRADOR',
      title: 'Pendiente',
    };
    incomplete.lines[0].unitPrice = '';
    await repository.create(incomplete);
    await reload();
    const row = element.querySelector(`[data-quote-id="${valid.id}"]`)!;
    expect(row.textContent).toContain('1.609,30 €');
    expect(row.textContent).toContain('235,95 €');
    expect(row.textContent).toContain(valid.title);
    expect(row.textContent).toContain(valid.client.name);
    expect(element.textContent).toContain('Cálculo incompleto');
    expect(element.querySelector(`a[href="/presupuestos/${valid.id}/editar"]`)).not.toBeNull();
  });

  it('busca por número, cliente y título, filtra estado y ordena por modificación', async () => {
    const first = await repository.create({
      ...createReferenceQuote(),
      number: 'PRIMERO',
      title: 'Mantenimiento',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    first.updatedAt = '2026-01-01T00:00:00Z';
    repository.documents.set(first.id, first);
    const other = changeQuoteStatus(
      {
        ...createReferenceQuote(),
        id: crypto.randomUUID(),
        number: 'SEGUNDO',
        title: 'Consultoría',
        client: { ...first.client, name: 'Cliente B' },
      },
      'sent',
    );
    repository.documents.set(other.id, { ...other, updatedAt: '2026-02-01T00:00:00Z' });
    await reload();
    expect(component.visibleRows().map((row) => row.quote.number)).toEqual(['SEGUNDO', 'PRIMERO']);
    for (const term of ['segundo', 'cliente b', 'consultoría']) {
      const input = element.querySelector<HTMLInputElement>('#quote-search')!;
      input.value = term;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(element.querySelectorAll('tbody tr')).toHaveLength(1);
      expect(component.visibleRows()[0].quote.id).toBe(other.id);
    }
    component.search.set('');
    component.status.set('draft');
    fixture.detectChanges();
    expect(component.visibleRows()[0].quote.id).toBe(first.id);
    component.status.set('all');
    component.order.set('asc');
    expect(component.visibleRows()[0].quote.id).toBe(first.id);
  });

  it('usa los totales almacenados para documentos cerrados y duplica sin cambiar el original', async () => {
    const closed = changeQuoteStatus(createReferenceQuote(), 'sent');
    closed.lines[0].unitPrice = '900.00'; // Simula un documento cuyo resultado histórico no debe recalcular la lista.
    repository.documents.set(closed.id, closed);
    await reload();
    expect(element.textContent).toContain('1.609,30 €');
    await component.duplicate(closed);
    expect(repository.documents.get(closed.id)).toEqual(closed);
    expect(repository.documents.size).toBe(2);
    const copy = [...repository.documents.values()].find((item) => item.id !== closed.id)!;
    expect(copy.status).toBe('draft');
    expect(copy.lines[0].unitPrice).toBe('900.00');
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([
      '/presupuestos',
      copy.id,
      'editar',
    ]);
  });

  it('confirma el documento afectado, permite cancelar y conserva la fila si falla eliminar', async () => {
    const quote = await repository.create(createReferenceQuote());
    await reload();
    component.askDelete(quote);
    fixture.detectChanges();
    expect(element.querySelector('dialog')!.textContent).toContain(quote.number);
    expect(element.querySelector('dialog')!.textContent).toContain(quote.client.name);
    component.cancelDelete();
    expect(repository.documents.has(quote.id)).toBe(true);
    vi.spyOn(repository, 'delete').mockRejectedValueOnce(new Error('No se pudo eliminar'));
    component.askDelete(quote);
    await component.confirmDelete();
    fixture.detectChanges();
    expect(element.textContent).toContain('No se pudo eliminar');
    expect(component.quotes()).toHaveLength(1);
    await component.confirmDelete();
    fixture.detectChanges();
    expect(repository.documents.size).toBe(0);
    expect(element.textContent).toContain('Todavía no hay presupuestos');
  });

  it('muestra errores de lectura y permite reintentar sin vaciar los datos anteriores', async () => {
    const quote = await repository.create(createReferenceQuote());
    await reload();
    vi.spyOn(repository, 'list').mockRejectedValueOnce(new Error('Lectura fallida'));
    await reload();
    expect(element.textContent).toContain('Lectura fallida');
    expect(component.quotes()).toEqual([quote]);
    expect(element.textContent).toContain('Reintentar carga');
    await reload();
    expect(component.state()).toBe('ready');
    expect(component.quotes()).toEqual([quote]);
  });
});
