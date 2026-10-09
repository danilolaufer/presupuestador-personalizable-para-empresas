import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Settings } from './settings';
import { SETTINGS_REPOSITORY } from './settings-repository';
import { MemorySettingsRepository } from './testing/memory-settings-repository';
import { readSettingsForm } from './settings-form';
import { deferred } from '../quotes/testing/memory-quote-repository';
import { isValidLogoDataUrl, MAX_LOGO_BYTES, readLogoFile } from './logo-file';
import { provideRouter } from '@angular/router';
import { QUOTE_REPOSITORY } from '../quotes/quote-repository';
import { MemoryQuoteRepository } from '../quotes/testing/memory-quote-repository';

describe('Configuración y catálogo en el DOM', () => {
  let repository: MemorySettingsRepository;
  let fixture: ComponentFixture<Settings>;
  let component: Settings;
  let element: HTMLElement;
  beforeEach(async () => {
    repository = new MemorySettingsRepository();
    TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideRouter([]),
        { provide: SETTINGS_REPOSITORY, useValue: repository },
        { provide: QUOTE_REPOSITORY, useValue: new MemoryQuoteRepository() },
      ],
    });
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    element = fixture.nativeElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => vi.restoreAllMocks());
  async function input(id: string, value: string) {
    const field = element.querySelector<HTMLInputElement>('#' + id)!;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
  }
  async function click(text: string) {
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === text,
    );
    if (!button) throw new Error('Botón ausente: ' + text);
    button.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('edita empresa, preferencias y plantilla, guarda y recupera todos los datos', async () => {
    await input('settings-commercial-name', 'Marca ficticia');
    await input('settings-issuer-name', 'Empresa ficticia SL');
    await input('settings-payment-holder', 'Titular ficticio');
    await input('settings-vat', '10,5');
    await input('settings-validity', '45');
    await click('Añadir plantilla');
    await input('template-0-name', 'Consultoría ficticia');
    await input('template-0-unit', 'hora');
    await input('template-0-price', '50,00');
    await click('Guardar configuración');
    expect(component.state()).toBe('saved');
    expect(repository.settings).toMatchObject({
      brand: { name: 'Marca ficticia' },
      issuer: { name: 'Empresa ficticia SL' },
      payment: { holder: 'Titular ficticio' },
      suggestedVatRate: '10.5',
      validityDays: 45,
      catalog: [
        { name: 'Consultoría ficticia', unitPrice: '50.00', vat: { kind: 'taxed', rate: '10.5' } },
      ],
    });
    const expected = readSettingsForm(component.form, repository.settings.revision);
    await component.load();
    fixture.detectChanges();
    expect(readSettingsForm(component.form, repository.settings.revision)).toEqual(expected);
    expect(component.pending()).toBe(false);
    expect(element.textContent).toContain('Configuración guardada');
  });

  it('rechaza plazo vacío, IVA inválido y plantillas incompletas con mensajes visibles', async () => {
    await input('settings-validity', '');
    await input('settings-vat', '101');
    await click('Añadir plantilla');
    await click('Guardar configuración');
    expect(element.textContent).toContain('plazo de validez');
    expect(element.textContent).toContain('IVA sugerido');
    expect(element.textContent).toContain('completa nombre y unidad');
    expect(repository.settings.revision).toBe(0);
    expect(component.pending()).toBe(true);
  });

  it('solo muestra guardado después de completar la escritura y conserva valores ante un error', async () => {
    await input('settings-commercial-name', 'Local');
    const gate = deferred<void>();
    const realSave = repository.save.bind(repository);
    vi.spyOn(repository, 'save')
      .mockImplementationOnce(async (settings, revision) => {
        await gate.promise;
        return realSave(settings, revision);
      })
      .mockRejectedValueOnce(new Error('Fallo de almacenamiento'));
    const saving = component.save();
    expect(component.state()).toBe('saving');
    expect(component.form.disabled).toBe(true);
    gate.resolve(undefined);
    expect(await saving).toBe(true);
    await input('settings-commercial-name', 'Nueva edición');
    expect(await component.save()).toBe(false);
    fixture.detectChanges();
    expect(component.form.controls.brand.controls.name.value).toBe('Nueva edición');
    expect(element.textContent).toContain('Fallo de almacenamiento');
    expect(await component.save()).toBe(true);
  });

  it('protege cambios locales ante conflicto, cancelación de recarga y salida fallida', async () => {
    await repository.save(
      { ...repository.settings, brand: { ...repository.settings.brand, name: 'Otra pestaña' } },
      0,
    );
    await input('settings-commercial-name', 'Local');
    expect(await component.save()).toBe(false);
    expect(component.state()).toBe('conflict');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await component.load(true);
    expect(component.form.controls.brand.controls.name.value).toBe('Local');
    expect(await component.confirmLeave()).toBe(false);
    confirm.mockReturnValue(true);
    await component.load(true);
    expect(component.form.controls.brand.controls.name.value).toBe('Otra pestaña');
    expect(component.pending()).toBe(false);
  });

  it('pide confirmar la eliminación de una plantilla y distingue fallos de lectura', async () => {
    await click('Añadir plantilla');
    await input('template-0-name', 'Servicio ficticio');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await click('Eliminar plantilla 1');
    expect(component.form.controls.catalog.length).toBe(1);
    confirm.mockReturnValue(true);
    await click('Eliminar plantilla 1');
    expect(component.form.controls.catalog.length).toBe(0);
    const before = component.form.getRawValue();
    vi.spyOn(repository, 'load').mockRejectedValueOnce(new Error('Lectura fallida'));
    await component.load(true);
    fixture.detectChanges();
    expect(component.form.getRawValue()).toEqual(before);
    expect(element.textContent).toContain('Lectura fallida');
  });
});

describe('Validación del logo', () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  it('admite los formatos raster y rechaza SVG, contenido incorrecto y más de 300 KiB', async () => {
    expect(isValidLogoDataUrl(png)).toBe(true);
    expect(isValidLogoDataUrl('data:image/jpeg;base64,/9j/2Q==')).toBe(true);
    expect(isValidLogoDataUrl('data:image/webp;base64,' + btoa('RIFF0000WEBP'))).toBe(true);
    expect(isValidLogoDataUrl('data:image/svg+xml;base64,' + btoa('<svg/>'))).toBe(false);
    expect(isValidLogoDataUrl('data:image/png;base64,' + btoa('no es PNG'))).toBe(false);
    await expect(
      readLogoFile(new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })),
    ).rejects.toThrow('PNG');
    await expect(
      readLogoFile(
        new File([new Uint8Array(MAX_LOGO_BYTES + 1)], 'large.png', { type: 'image/png' }),
      ),
    ).rejects.toThrow('300 KiB');
    await expect(
      readLogoFile(new File(['texto'], 'fake.png', { type: 'image/png' })),
    ).rejects.toThrow('contenido');
  });
});
