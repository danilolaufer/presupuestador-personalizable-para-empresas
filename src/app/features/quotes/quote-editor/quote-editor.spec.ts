import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { QuoteEditor } from './quote-editor';
import { provideRouter, Router } from '@angular/router';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { MemoryQuoteRepository } from '../testing/memory-quote-repository';
import { EmergencyQuoteBackup } from '../../../core/backup/emergency-quote-backup';
import { readQuoteForm } from './quote-form';

describe('Recorrido del editor en el DOM', () => {
  let fixture: ComponentFixture<QuoteEditor>;
  let editor: QuoteEditor;
  let element: HTMLElement;
  let repository: MemoryQuoteRepository;

  beforeEach(async () => {
    repository = new MemoryQuoteRepository();
    await TestBed.configureTestingModule({
      imports: [QuoteEditor],
      providers: [
        provideRouter([]),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useClass: MemorySettingsRepository },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(QuoteEditor);
    editor = fixture.componentInstance;
    element = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
    fixture.detectChanges();
    // jsdom no representa diálogos nativos. Se simula únicamente su apertura/cierre.
    for (const dialog of element.querySelectorAll('dialog')) {
      dialog.showModal = () => {
        dialog.open = true;
      };
      dialog.close = () => {
        dialog.open = false;
      };
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function render() {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function click(text: string) {
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === text,
    );
    if (!button) throw new Error(`No se encuentra el botón ${text}`);
    button.click();
    await render();
  }

  async function input(selector: string, value: string) {
    const field = element.querySelector<HTMLInputElement>(selector);
    if (!field) throw new Error(`No se encuentra el campo ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await render();
    return field;
  }

  function total(index = 2) {
    return element
      .querySelector(`[data-summary="${index}"] .summary-total dd`)
      ?.textContent?.trim();
  }

  it('carga 1845.25 y muestra 2208.25 al introducir diez sitios en el campo de cantidad', async () => {
    expect(element.textContent).toContain('Cálculo incompleto');
    expect(element.querySelectorAll('[data-line-id]')).toHaveLength(0);
    await click('Cargar ejemplo');
    expect(total()).toBe('1.845,25 €');
    expect(total(0)).toBe('1.609,30 €');
    expect(total(1)).toBe('235,95 €');
    await input('input[id$="-quantity"]', '10');
    expect(total()).toBe('2.208,25 €');
    expect(total(0)).toBe('1.972,30 €');
    expect(total(1)).toBe('235,95 €');
  });

  it('muestra el error asociado al precio vacío y oculta todos los totales anteriores', async () => {
    await click('Cargar ejemplo');
    const price = await input('input[id$="-unitPrice"]', '');
    expect(price.value).toBe('');
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector(`#${price.id}-error`)?.textContent).toContain(
      'Completa este valor',
    );
    expect(element.textContent).toContain('Cálculo incompleto');
    expect(element.querySelectorAll('[data-summary]')).toHaveLength(0);
    await input(`#${price.id}`, '150,00');
    expect(total()).toBe('1.845,25 €');
    expect(price.getAttribute('aria-invalid')).toBe('false');
  });

  it('permite cancelar la carga del ejemplo sin perder ni modificar los cambios', async () => {
    await input('#quote-number', 'BORRADOR-PROPIO');
    await click('Cargar ejemplo');
    expect(element.querySelector('dialog')?.open).toBe(true);
    expect(editor.form.controls.number.value).toBe('BORRADOR-PROPIO');
    await click('Cancelar');
    expect(element.querySelector('dialog')?.open).toBe(false);
    expect(editor.form.controls.number.value).toBe('BORRADOR-PROPIO');
    expect(editor.form.controls.lines.length).toBe(0);
    await click('Cargar ejemplo');
    await click('Reemplazar con el ejemplo');
    expect(editor.form.controls.number.value).toBe('BORRADOR-PROPIO');
    expect(editor.form.controls.lines.length).toBe(3);
    expect(total()).toBe('1.845,25 €');
    expect(element.querySelector('dialog')?.open).toBe(false);
  });

  it('añade, duplica, mueve y elimina desde los botones manteniendo el foco en un campo útil', async () => {
    await click('Cargar ejemplo');
    const firstId = editor.form.controls.lines.at(0).controls.id.value;
    element.querySelector<HTMLButtonElement>('[aria-label="Duplicar servicio 1"]')!.click();
    await render();
    const copyId = editor.form.controls.lines.at(1).controls.id.value;
    expect(copyId).not.toBe(firstId);
    expect(total()).toBe('3.297,25 €');
    expect(document.activeElement?.id).toBe(`line-${copyId}-name`);
    element.querySelector<HTMLButtonElement>('[aria-label="Subir servicio 2"]')!.click();
    await render();
    expect(element.querySelector('[data-line-id]')?.getAttribute('data-line-id')).toBe(copyId);
    expect(editor.form.controls.lines.at(0).controls.id.value).toBe(copyId);
    expect(document.activeElement?.id).toBe(`line-${copyId}-name`);
    element.querySelector<HTMLButtonElement>('[aria-label="Eliminar servicio 1"]')!.click();
    await render();
    expect(total()).toBe('1.845,25 €');
    await click('Añadir servicio');
    expect(element.querySelectorAll('[data-line-id]')).toHaveLength(4);
    expect(element.textContent).toContain('Cálculo incompleto');
    element.querySelector<HTMLButtonElement>('[aria-label="Eliminar servicio 4"]')!.click();
    await render();
    expect(total()).toBe('1.845,25 €');
    expect(
      element.querySelector<HTMLButtonElement>('[aria-label="Subir servicio 1"]')?.disabled,
    ).toBe(true);
    expect(
      element.querySelector<HTMLButtonElement>('[aria-label="Bajar servicio 3"]')?.disabled,
    ).toBe(true);
  });

  it('conecta descuento y periodicidad de los selects con el resumen sin calcular en la vista', async () => {
    await click('Cargar ejemplo');
    const discount = element.querySelector<HTMLSelectElement>('select[id$="-discount-kind"]')!;
    discount.value = 'fixed';
    discount.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(element.textContent).toContain('Cálculo incompleto');
    await input('input[id$="-discount-value"]', '10,00');
    expect(total()).toBe('1.833,15 €');
    const frequency = element.querySelector<HTMLSelectElement>('select[id$="-frequency"]')!;
    frequency.value = 'one-time';
    frequency.dispatchEvent(new Event('change', { bubbles: true }));
    await render();
    expect(total(0)).toBe('157,30 €');
    expect(total(1)).toBe('1.675,85 €');
    expect(total()).toBe('1.833,15 €');
  });

  it('permite revisar datos documentales y fechas sin bloquear un cálculo numérico válido', async () => {
    await click('Cargar ejemplo');
    await input('#quote-validUntil', '2026-09-16');
    await input('#quote-client-name', 'Cliente editado');
    await input('#quote-conditions-notes', 'Observación ficticia nueva');
    await click('Revisar campos');
    expect(element.querySelector('#quote-validUntil-error')?.textContent).toContain(
      'antes de la emisión',
    );
    expect(editor.store.quote().client.name).toBe('Cliente editado');
    expect(editor.store.quote().conditions.notes).toBe('Observación ficticia nueva');
    expect(total()).toBe('1.845,25 €');
    expect(document.activeElement?.id).toBe('quote-validUntil');
  });

  it('usa etiquetas asociadas, conserva importes como texto y solo llama pago inicial al acuerdo explícito', async () => {
    await click('Cargar ejemplo');
    for (const control of element.querySelectorAll<HTMLInputElement>('input, textarea, select')) {
      expect(control.id).not.toBe('');
      expect(element.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
    }
    const price = element.querySelector<HTMLInputElement>('input[id$="-unitPrice"]')!;
    expect(price.type).toBe('text');
    expect(price.getAttribute('inputmode')).toBe('decimal');
    expect(element.querySelector('[data-summary="2"] h3')?.textContent).toContain('Conjunto');
    element.querySelector<HTMLInputElement>('#include-first-month')!.click();
    await render();
    expect(element.querySelector('[data-summary="2"] h3')?.textContent).toBe('Pago inicial');
    expect(total()).toBe('1.845,25 €');
  });

  it('avisa al abandonar o recargar un editor con cambios y permite cancelar la salida', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await editor.confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    await input('#quote-number', 'BORRADOR');
    vi.spyOn(repository, 'save').mockRejectedValue(new Error('Escritura fallida de prueba'));
    expect(await editor.confirmLeave()).toBe(false);
    confirm.mockReturnValue(true);
    expect(await editor.confirmLeave()).toBe(true);
    const event = new Event('beforeunload', { cancelable: true });
    editor.beforeUnload(event as BeforeUnloadEvent);
    expect(event.defaultPrevented).toBe(true);
  });

  it('muestra el fallo, descarga el borrador actual y permite reintentar sin perder el precio vacío', async () => {
    await click('Cargar ejemplo');
    await input('input[id$="-unitPrice"]', '');
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('Fallo simulado'));
    const download = vi
      .spyOn(TestBed.inject(EmergencyQuoteBackup), 'download')
      .mockImplementation(() => {});
    expect(await editor.store.flush()).toBe(false);
    await render();
    expect(element.textContent).toContain('Error al guardar');
    await click('Descargar borrador (JSON)');
    expect(download).toHaveBeenCalledWith(readQuoteForm(editor.form));
    expect(download.mock.calls[0][0].lines[0].unitPrice).toBe('');
    await click('Reintentar guardado');
    await vi.waitFor(() => expect(editor.store.saveState()).toBe('saved'));
    await render();
    expect(element.textContent).toContain('Guardado a las');
    expect(element.textContent).toContain('Cálculo incompleto');
    const event = new Event('beforeunload', { cancelable: true });
    editor.beforeUnload(event as BeforeUnloadEvent);
    expect(event.defaultPrevented).toBe(false);
  });

  it('permite exportar y cancelar un conflicto antes de descartar explícitamente el borrador local', async () => {
    await click('Cargar ejemplo');
    expect(await editor.store.flush()).toBe(true);
    const stored = readQuoteForm(editor.form);
    await repository.save({ ...stored, number: 'OTRA PESTAÑA' }, stored.revision);
    await input('#quote-number', 'MIS CAMBIOS LOCALES');
    expect(await editor.store.flush()).toBe(false);
    await render();
    expect(element.textContent).toContain('Conflicto de versiones');
    const download = vi
      .spyOn(TestBed.inject(EmergencyQuoteBackup), 'download')
      .mockImplementation(() => {});
    await click('Descargar borrador (JSON)');
    expect(download.mock.calls[0][0].number).toBe('MIS CAMBIOS LOCALES');
    await click('Cargar versión almacenada…');
    const dialog = element.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="conflict-title"]',
    )!;
    expect(dialog.open).toBe(true);
    dialog.querySelector<HTMLButtonElement>('button')!.click();
    await render();
    expect(dialog.open).toBe(false);
    expect(editor.form.controls.number.value).toBe('MIS CAMBIOS LOCALES');
    expect(editor.store.hasPendingChanges()).toBe(true);
    await click('Cargar versión almacenada…');
    await click('Descartar cambios locales y cargar');
    await vi.waitFor(() => expect(editor.form.controls.number.value).toBe('OTRA PESTAÑA'));
    expect(editor.store.hasPendingChanges()).toBe(false);
    expect(editor.store.saveState()).toBe('saved');
  });
});
