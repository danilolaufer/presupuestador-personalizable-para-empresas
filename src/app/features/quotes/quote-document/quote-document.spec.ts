import { TestBed } from '@angular/core/testing';
import { createReferenceQuote } from '../../../domain/quotes/quote-fixtures';
import { changeQuoteStatus } from '../../../domain/quotes/quote-lifecycle';
import { calculateQuote } from '../../../domain/quotes/calculate-quote';
import { QuoteDocument, documentView } from './quote-document';
import { prepareDocumentPrint } from './print-document';

describe('Documento compartido de pantalla e impresión', () => {
  afterEach(() => vi.restoreAllMocks());
  it('presenta el ejemplo con los mismos importes que la calculadora del editor', () => {
    const quote = createReferenceQuote();
    const fixture = TestBed.createComponent(QuoteDocument);
    fixture.componentRef.setInput('quote', quote);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    for (const amount of ['1.525,00 €', '320,25 €', '1.845,25 €', '1.609,30 €', '235,95 €'])
      expect(text).toContain(amount);
    expect(text).toContain('PRESUPUESTO');
    expect(text).toContain('BORRADOR');
    const calculated = calculateQuote(quote);
    expect(calculated.status).toBe('valid');
    if (calculated.status === 'valid')
      expect(documentView(quote).totals).toEqual(calculated.totals);
    quote.lines[0].quantity = '10';
    expect(documentView(quote).totals?.combined.total).toBe('2208.25');
  });

  it('usa datos y logo históricos, sin convertir texto del usuario en HTML y ocultando opcionales vacíos', () => {
    const quote = createReferenceQuote();
    quote.brand.logoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    quote.issuer.name = 'Empresa histórica';
    quote.lines[0].description = '<img src=x onerror=alert(1)>\nDescripción literal';
    const fixture = TestBed.createComponent(QuoteDocument);
    fixture.componentRef.setInput('quote', quote);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Empresa histórica');
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(element.querySelectorAll('img')).toHaveLength(1);
    expect(element.querySelector('img')?.getAttribute('src')).toBe(quote.brand.logoDataUrl);
    expect(element.textContent).not.toContain('IBAN:');
    expect(element.textContent).not.toContain('Titular:');
    expect(element.textContent).not.toContain('Observaciones');
  });

  it('lee importes cerrados sin recalcularlos a partir de los precios', () => {
    const sent = changeQuoteStatus(createReferenceQuote(), 'sent');
    // Un centinela distingue leer totales conservados de volver a ejecutar calculateQuote.
    sent.lines[0].unitPrice = '200.00';
    expect(documentView(sent).totals).toBe(sent.totals);
    expect(documentView(sent).totals?.combined.total).toBe('1845.25');
    expect(documentView(sent).issues).toEqual([]);
  });

  it('indica campos incompletos, no inventa ceros y detecta importes históricos incoherentes', () => {
    const quote = createReferenceQuote();
    quote.lines[0].unitPrice = '';
    quote.client.name = '';
    const view = documentView(quote);
    expect(view.totals).toBeNull();
    expect(view.issues.join(' ')).toContain('Precio');
    expect(view.issues.join(' ')).toContain('Nombre del cliente');
    const sent = changeQuoteStatus(createReferenceQuote(), 'sent');
    sent.totals.combined.total = '2.00';
    expect(documentView(sent).totals).toBeNull();
    expect(documentView(sent).issues.length).toBeGreaterThan(0);
  });

  it('renderiza muchas líneas y una descripción de más de una página sin truncar el texto', () => {
    const quote = createReferenceQuote();
    quote.lines = Array.from({ length: 55 }, (_, i) => ({
      ...quote.lines[i % 3],
      id: crypto.randomUUID(),
    }));
    quote.lines[0].description =
      'Descripción extensa de un servicio ficticio.\n'.repeat(200) + 'FIN DEL TEXTO';
    const fixture = TestBed.createComponent(QuoteDocument);
    fixture.componentRef.setInput('quote', quote);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.service-group')).toHaveLength(55);
    expect(element.querySelector('.description-row')?.textContent).toContain(
      quote.lines[0].description,
    );
    expect(element.querySelector('thead')).not.toBeNull();
    // JSDOM no pagina: este caso verifica contenido completo, no el PDF ni sus saltos.
  });

  it('espera a una imagen pendiente y rechaza una imagen rota antes de imprimir', async () => {
    const element = document.createElement('div');
    const image = document.createElement('img');
    element.append(image);
    Object.defineProperty(image, 'complete', { get: () => false });
    Object.defineProperty(image, 'naturalWidth', { get: () => 100 });
    Object.defineProperty(image, 'naturalHeight', { get: () => 100 });
    let ready = false;
    const pending = prepareDocumentPrint(element, document).then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    image.dispatchEvent(new Event('load'));
    await pending;
    expect(ready).toBe(true);
    const failing = prepareDocumentPrint(element, document);
    image.dispatchEvent(new Event('error'));
    await expect(failing).rejects.toThrow('logo');
  });
});
