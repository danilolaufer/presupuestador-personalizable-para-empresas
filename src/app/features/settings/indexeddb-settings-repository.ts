import { Injectable } from '@angular/core';
import { AppDatabase, runTransaction } from '../../core/persistence/app-database';
import {
  defaultSettings,
  readStoredSettings,
  settingsIssues,
  type AppSettings,
} from './app-settings';
import { SettingsConflictError, type SettingsRepository } from './settings-repository';

@Injectable()
export class IndexedDbSettingsRepository implements SettingsRepository {
  constructor(private readonly database: AppDatabase) {}
  async load(): Promise<AppSettings> {
    return runTransaction(
      await this.database.open(),
      'settings',
      'readonly',
      (store, result, abort) => {
        const request = store.get('app');
        request.onsuccess = () => {
          try {
            result(
              request.result === undefined ? defaultSettings() : readStoredSettings(request.result),
            );
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }
  async save(settings: AppSettings, expectedRevision: number): Promise<AppSettings> {
    const snapshot = structuredClone(settings);
    const issues = settingsIssues(snapshot);
    if (issues.length) throw new Error(issues.join(' '));
    return runTransaction(
      await this.database.open(),
      'settings',
      'readwrite',
      (store, result, abort) => {
        const request = store.get('app');
        request.onsuccess = () => {
          try {
            const current =
              request.result === undefined ? defaultSettings() : readStoredSettings(request.result);
            if (current.revision !== expectedRevision) throw new SettingsConflictError();
            const saved: AppSettings = {
              ...snapshot,
              id: 'app',
              schemaVersion: 1,
              revision: current.revision + 1,
              updatedAt: new Date().toISOString(),
            };
            readStoredSettings(saved);
            store.put(saved);
            result(saved);
          } catch (error) {
            abort(error);
          }
        };
      },
    );
  }
}
