import { InjectionToken } from '@angular/core';
import type { AppSettings } from './app-settings';

export interface SettingsRepository {
  load(): Promise<AppSettings>;
  save(settings: AppSettings, expectedRevision: number): Promise<AppSettings>;
}
export const SETTINGS_REPOSITORY = new InjectionToken<SettingsRepository>('SETTINGS_REPOSITORY');
export class SettingsConflictError extends Error {
  constructor() {
    super('Otra pestaña ha modificado la configuración. Tus cambios locales se conservan.');
  }
}
