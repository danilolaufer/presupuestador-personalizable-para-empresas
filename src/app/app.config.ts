import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { QUOTE_REPOSITORY } from './features/quotes/quote-repository';
import { IndexedDbQuoteRepository } from './features/quotes/indexeddb-quote-repository';
import { SETTINGS_REPOSITORY } from './features/settings/settings-repository';
import { IndexedDbSettingsRepository } from './features/settings/indexeddb-settings-repository';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: QUOTE_REPOSITORY, useClass: IndexedDbQuoteRepository },
    { provide: SETTINGS_REPOSITORY, useClass: IndexedDbSettingsRepository },
  ],
};
