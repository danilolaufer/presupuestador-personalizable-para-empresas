import { defaultSettings, settingsIssues, type AppSettings } from '../app-settings';
import { SettingsConflictError, type SettingsRepository } from '../settings-repository';
export class MemorySettingsRepository implements SettingsRepository {
  settings = defaultSettings();
  async load(): Promise<AppSettings> {
    return structuredClone(this.settings);
  }
  async save(settings: AppSettings, expectedRevision: number): Promise<AppSettings> {
    if (this.settings.revision !== expectedRevision) throw new SettingsConflictError();
    const issues = settingsIssues(settings);
    if (issues.length) throw new Error(issues.join(' '));
    this.settings = {
      ...structuredClone(settings),
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    return structuredClone(this.settings);
  }
}
