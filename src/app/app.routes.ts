import { Routes } from '@angular/router';
import type { QuoteEditor } from './features/quotes/quote-editor/quote-editor';
import type { Settings } from './features/settings/settings';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'presupuestos' },
  {
    path: 'presupuestos/nuevo',
    title: 'Editor · Presupuestador',
    loadComponent: () =>
      import('./features/quotes/quote-editor/quote-editor').then((module) => module.QuoteEditor),
    canDeactivate: [(editor: QuoteEditor) => editor.confirmLeave()],
  },
  {
    path: 'presupuestos',
    title: 'Presupuestos · Presupuestador',
    loadComponent: () =>
      import('./features/quotes/quote-list/quote-list').then((module) => module.QuoteList),
  },
  {
    path: 'presupuestos/:id/editar',
    title: 'Editar presupuesto · Presupuestador',
    loadComponent: () =>
      import('./features/quotes/quote-editor/quote-editor').then((module) => module.QuoteEditor),
    canDeactivate: [(editor: QuoteEditor) => editor.confirmLeave()],
  },
  {
    path: 'presupuestos/:id/vista-previa',
    title: 'Vista previa · Presupuestador',
    loadComponent: () =>
      import('./features/quotes/quote-preview/quote-preview').then((module) => module.QuotePreview),
  },
  {
    path: 'configuracion',
    title: 'Configuración · Presupuestador',
    loadComponent: () => import('./features/settings/settings').then((module) => module.Settings),
    canDeactivate: [(settings: Settings) => settings.confirmLeave()],
  },
  { path: '**', redirectTo: 'presupuestos' },
];
