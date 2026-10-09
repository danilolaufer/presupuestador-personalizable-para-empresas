import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IDBFactory } from 'fake-indexeddb';
import { routes } from '../../app.routes';
import { AppDatabase } from '../../core/persistence/app-database';
import { QUOTE_REPOSITORY } from './quote-repository';
import { IndexedDbQuoteRepository } from './indexeddb-quote-repository';
import { SETTINGS_REPOSITORY } from '../settings/settings-repository';
import { IndexedDbSettingsRepository } from '../settings/indexeddb-settings-repository';
import { QuoteList } from './quote-list/quote-list';
import { QuoteEditor } from './quote-editor/quote-editor';

describe('Recorrido integrado de gestión con Router, DOM e IndexedDB simulado', () => {
  it('crea desde el listado, guarda, recupera, envía y crea una revisión desde sus botones', async () => {
    const database = new AppDatabase(new IDBFactory(), crypto.randomUUID());
    const repository = new IndexedDbQuoteRepository(database);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: QUOTE_REPOSITORY, useValue: repository },
        { provide: SETTINGS_REPOSITORY, useValue: new IndexedDbSettingsRepository(database) },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const router = TestBed.inject(Router);
    try {
      const list = await harness.navigateByUrl('/presupuestos', QuoteList);
      await vi.waitFor(() => expect(list.state()).toBe('ready'));
      harness.detectChanges();
      harness
        .routeNativeElement!.querySelector<HTMLAnchorElement>('a[href="/presupuestos/nuevo"]')!
        .click();
      await vi.waitFor(() => expect(router.url).toMatch(/^\/presupuestos\/.+\/editar$/));
      let editor = harness.routeDebugElement!.componentInstance as QuoteEditor;
      await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
      harness.detectChanges();
      const id = editor.store.quote().id;
      const button = (label: string) => {
        const item = [
          ...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button'),
        ].find((item) => item.textContent?.trim() === label);
        if (!item) throw new Error('Falta el botón ' + label);
        return item;
      };
      button('Cargar ejemplo').click();
      harness.detectChanges();
      const title = harness.routeNativeElement!.querySelector<HTMLInputElement>('#quote-title')!;
      title.value = 'Documento del recorrido';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      // Navegar al listado fuerza el guardado y destruye este editor.
      await harness.navigateByUrl('/presupuestos', QuoteList);
      editor = await harness.navigateByUrl(`/presupuestos/${id}/editar`, QuoteEditor);
      await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
      harness.detectChanges();
      expect(editor.form.controls.title.value).toBe('Documento del recorrido');
      expect(editor.form.controls.lines.length).toBe(3);
      button('Marcar como enviado').click();
      await vi.waitFor(() => expect(editor.store.loadState()).toBe('read-only'));
      harness.detectChanges();
      expect(harness.routeNativeElement!.textContent).toContain('1.845,25 €');
      expect(harness.routeNativeElement!.querySelector('form')).toBeNull();
      const original = await repository.findById(id);
      button('Crear revisión').click();
      await vi.waitFor(() => expect(router.url).not.toContain(id));
      await vi.waitFor(() => expect(editor.store.loadState()).toBe('ready'));
      harness.detectChanges();
      expect(editor.store.quote().revisionOfId).toBe(id);
      expect(editor.store.quote().number).not.toBe(original?.number);
      expect(await repository.findById(id)).toEqual(original);
    } finally {
      TestBed.resetTestingModule();
      database.close();
    }
  });
});
