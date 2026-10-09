import { SETTINGS_REPOSITORY } from '../../settings/settings-repository';
import { MemorySettingsRepository } from '../../settings/testing/memory-settings-repository';
import { TestBed } from '@angular/core/testing';
import { QuoteEditorStore } from './quote-editor-store';
import { QUOTE_REPOSITORY } from '../quote-repository';
import { MemoryQuoteRepository } from '../testing/memory-quote-repository';

describe('Coordinador del editor', () => {
  let store: QuoteEditorStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        QuoteEditorStore,
        { provide: QUOTE_REPOSITORY, useValue: new MemoryQuoteRepository() },
        { provide: SETTINGS_REPOSITORY, useClass: MemorySettingsRepository },
      ],
    });
    store = TestBed.inject(QuoteEditorStore);
    await store.open(null);
  });

  function totals() {
    const result = store.calculation();
    if (result.status !== 'valid') throw new Error(JSON.stringify(result.errors));
    return result.totals;
  }

  it('empieza vacío y calcula la referencia solo al cargar el ejemplo explícitamente', () => {
    expect(store.form.controls.lines.length).toBe(0);
    expect(store.hasChanges()).toBe(false);
    expect(store.calculation().status).toBe('incomplete');
    store.loadExample();
    expect(totals().monthly.total).toBe('1609.30');
    expect(totals().oneTime.total).toBe('235.95');
    expect(totals().combined.total).toBe('1845.25');
    expect(store.hasChanges()).toBe(true);
  });

  it('deriva 2208.25 al cambiar de 8 a 10 sitios, sin recalcular en el componente', () => {
    store.loadExample();
    store.form.controls.lines.at(0).controls.quantity.setValue('10');
    expect(totals().monthly.total).toBe('1972.30');
    expect(totals().oneTime.total).toBe('235.95');
    expect(totals().combined.total).toBe('2208.25');
  });

  it('retira los totales al vaciar un precio y vuelve a calcular al corregirlo', () => {
    store.loadExample();
    const price = store.form.controls.lines.at(0).controls.unitPrice;
    price.setValue('');
    expect(store.calculation().status).toBe('incomplete');
    expect(store.calculation()).not.toHaveProperty('totals');
    expect(price.value).toBe('');
    price.setValue('150,00');
    expect(totals().combined.total).toBe('1845.25');
  });

  it('actualiza descuento, IVA y periodicidad con los valores de los controles', () => {
    store.loadExample();
    const line = store.form.controls.lines.at(0);
    line.controls.discount.setValue({ kind: 'percentage', value: '10' });
    expect(totals().combined.discount).toBe('120.00');
    expect(totals().combined.total).toBe('1700.05');
    line.controls.vat.setValue({ kind: 'exempt', rate: '21', note: 'Exención ficticia' });
    expect(totals().combined.total).toBe('1473.25');
    line.controls.frequency.setValue('one-time');
    expect(totals().monthly.total).toBe('157.30');
    expect(totals().oneTime.total).toBe('1315.95');
  });

  it('mantiene el resumen calculable cuando falta información documental', () => {
    store.loadExample();
    store.form.controls.issuer.controls.name.setValue('');
    expect(store.form.invalid).toBe(true);
    expect(store.issues()).toContainEqual(expect.objectContaining({ field: 'issuer.name' }));
    expect(totals().combined.total).toBe('1845.25');
  });

  it('añade una línea incompleta y vuelve al resultado anterior al eliminarla', () => {
    store.loadExample();
    const id = store.addLine();
    expect(store.form.controls.lines.length).toBe(4);
    expect(store.form.controls.lines.at(3).controls.id.value).toBe(id);
    expect(store.calculation().status).toBe('incomplete');
    store.removeLine(3);
    expect(totals().combined.total).toBe('1845.25');
    store.removeLine(2);
    store.removeLine(1);
    store.removeLine(0);
    expect(store.calculation().status).toBe('incomplete');
    expect(store.calculation()).not.toHaveProperty('totals');
  });

  it('duplica de forma independiente, incluso cuando el texto numérico aún es inválido', () => {
    store.loadExample();
    const original = store.form.controls.lines.at(0);
    original.controls.quantity.setValue('2,');
    original.controls.discount.setValue({ kind: 'fixed', value: '' });
    const id = store.duplicateLine(0);
    const copy = store.form.controls.lines.at(1);
    expect(id).not.toBe(original.controls.id.value);
    expect(copy.getRawValue()).toEqual({ ...original.getRawValue(), id });
    copy.controls.name.setValue('Servicio duplicado de prueba');
    expect(original.controls.name.value).toBe('Mantenimiento web');
    expect(store.calculation().status).toBe('invalid');
  });

  it('reordena los mismos controles e identificadores y mantiene los importes', () => {
    store.loadExample();
    const first = store.form.controls.lines.at(0);
    first.controls.name.markAsTouched();
    const id = first.controls.id.value;
    store.moveLine(0, 1);
    expect(store.form.controls.lines.at(1)).toBe(first);
    expect(store.quote().lines[1].id).toBe(id);
    expect(first.controls.name.touched).toBe(true);
    expect(totals().combined.total).toBe('1845.25');
    expect(store.moveLine(0, -1)).toBeUndefined();
    expect(store.moveLine(2, 1)).toBeUndefined();
    expect(store.duplicateLine(-1)).toBeUndefined();
    store.moveLine(1, -1);
    expect(store.form.controls.lines.at(0)).toBe(first);
  });
});
