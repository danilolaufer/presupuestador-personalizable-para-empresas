import { TestBed } from '@angular/core/testing';
import { createReferenceQuote } from '../../domain/quotes/quote-fixtures';
import { EmergencyQuoteBackup, serializeEmergencyQuote } from './emergency-quote-backup';

describe('JSON de emergencia', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('incluye esquema, revisión y documento completo con vacíos y decimales como texto', () => {
    const quote = createReferenceQuote();
    quote.lines[0].unitPrice = '';
    quote.conditions.notes = 'Borrador con cambios locales';
    const copy = JSON.parse(serializeEmergencyQuote(quote));
    expect(copy).toMatchObject({ kind: 'presupuestador-emergency', schemaVersion: 1, quote });
    expect(Number.isNaN(Date.parse(copy.exportedAt))).toBe(false);
    expect(copy.quote.lines[0].unitPrice).toBe('');
    expect(copy.quote.lines[1].unitPrice).toBe('130.00');
    expect(copy.quote.schemaVersion).toBe(2);
    expect(copy.quote.revision).toBe(0);
  });

  it('inicia la descarga de un Blob JSON y libera el enlace temporal', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:emergency-test');
    const revokeObjectURL = vi.fn();
    // jsdom no descarga archivos: se comprueba la conexión con la API del navegador.
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
      expect(this.href).toBe('blob:emergency-test');
    });
    const quote = createReferenceQuote();
    TestBed.inject(EmergencyQuoteBackup).download(quote);
    expect(filename).toBe(`presupuesto-${quote.id}.json`);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:emergency-test');
  });
});
