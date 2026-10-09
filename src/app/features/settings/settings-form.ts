import { FormArray, FormControl, FormGroup } from '@angular/forms';
import {
  createLineForm,
  normalizeDecimalInput,
  readLineForm,
} from '../quotes/quote-editor/quote-form';
import {
  defaultSettings,
  templateLine,
  type AppSettings,
  type ServiceTemplate,
} from './app-settings';

const control = (value: string) => new FormControl(value, { nonNullable: true });
export function createSettingsForm(settings = defaultSettings()) {
  return new FormGroup({
    issuer: new FormGroup({
      name: control(settings.issuer.name),
      taxId: control(settings.issuer.taxId),
      address: control(settings.issuer.address),
      email: control(settings.issuer.email),
      phone: control(settings.issuer.phone),
    }),
    brand: new FormGroup({
      name: control(settings.brand.name),
      logoDataUrl: new FormControl<string | null>(settings.brand.logoDataUrl),
      accentColor: control(settings.brand.accentColor),
    }),
    payment: new FormGroup({
      method: control(settings.payment.method),
      holder: control(settings.payment.holder),
      iban: control(settings.payment.iban),
      instructions: control(settings.payment.instructions),
    }),
    conditions: new FormGroup({
      terms: control(settings.conditions.terms),
      notes: control(settings.conditions.notes),
      includesFirstMonthlyPayment: new FormControl(
        settings.conditions.includesFirstMonthlyPayment,
        { nonNullable: true },
      ),
    }),
    suggestedVatRate: control(settings.suggestedVatRate),
    validityDays: control(String(settings.validityDays)),
    catalog: new FormArray(
      settings.catalog.map((item) => createLineForm({ ...templateLine(item), id: item.id })),
    ),
  });
}
export type SettingsForm = ReturnType<typeof createSettingsForm>;
export function readSettingsForm(form: SettingsForm, revision: number): AppSettings {
  const raw = form.getRawValue();
  const catalog: ServiceTemplate[] = form.controls.catalog.controls.map((group) => {
    const { id, name, description, unit, unitPrice, frequency, vat } = readLineForm(group);
    return { id, name, description, unit, unitPrice, frequency, vat };
  });
  return {
    ...raw,
    id: 'app',
    schemaVersion: 1,
    revision,
    updatedAt: null,
    catalog,
    suggestedVatRate: normalizeDecimalInput(raw.suggestedVatRate),
    validityDays: /^\d+$/.test(raw.validityDays) ? Number(raw.validityDays) : NaN,
  };
}
