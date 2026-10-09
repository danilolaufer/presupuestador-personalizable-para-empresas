import type {
  BrandSnapshot,
  PartySnapshot,
  PaymentSnapshot,
  QuoteConditions,
} from '../../domain/quotes/quote';
import type { BillingFrequency, QuoteLine, Vat } from '../../domain/quotes/quote-line';
import { validateQuote } from '../../domain/quotes/validate-quote';
import { isValidLogoDataUrl } from './logo-file';

export interface ServiceTemplate {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: string;
  frequency: BillingFrequency;
  vat: Vat;
}

export interface AppSettings {
  id: 'app';
  schemaVersion: 1;
  revision: number;
  updatedAt: string | null;
  issuer: PartySnapshot;
  brand: BrandSnapshot;
  payment: PaymentSnapshot;
  conditions: QuoteConditions;
  suggestedVatRate: string;
  validityDays: number;
  catalog: ServiceTemplate[];
}

export function defaultSettings(): AppSettings {
  return {
    id: 'app',
    schemaVersion: 1,
    revision: 0,
    updatedAt: null,
    issuer: { name: '', taxId: '', address: '', phone: '', email: '' },
    brand: { name: '', logoDataUrl: null, accentColor: '#125e57' },
    payment: { method: '', holder: '', iban: '', instructions: '' },
    conditions: { terms: '', notes: '', includesFirstMonthlyPayment: false },
    suggestedVatRate: '21',
    validityDays: 30,
    catalog: [],
  };
}

export function templateLine(template: ServiceTemplate): QuoteLine {
  return {
    ...structuredClone(template),
    id: crypto.randomUUID(),
    sourceServiceId: template.id,
    quantity: '1',
    discount: { kind: 'none' },
  };
}

/** Configuración parcial de empresa permitida; preferencias y plantillas deben ser utilizables. */
export function settingsIssues(settings: AppSettings): string[] {
  const issues: string[] = [];
  if (
    !Number.isInteger(settings.validityDays) ||
    settings.validityDays < 0 ||
    settings.validityDays > 3650
  )
    issues.push('El plazo de validez debe ser un entero entre 0 y 3650 días.');
  if (!/^#[\da-f]{6}$/i.test(settings.brand.accentColor))
    issues.push('El color debe tener formato #RRGGBB.');
  if (settings.brand.logoDataUrl !== null && !isValidLogoDataUrl(settings.brand.logoDataUrl))
    issues.push('El logo debe ser PNG, JPEG o WebP válido y ocupar como máximo 300 KiB.');
  if (settings.issuer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.issuer.email))
    issues.push('Revisa el correo electrónico de la empresa.');
  const sample: QuoteLine = {
    id: 'settings-vat',
    name: '',
    description: '',
    unit: '',
    quantity: '1',
    unitPrice: '0',
    discount: { kind: 'none' },
    frequency: 'one-time',
    vat: { kind: 'taxed', rate: settings.suggestedVatRate },
  };
  if (validateQuote({ currency: 'EUR', lines: [sample] }).length)
    issues.push('El IVA sugerido debe ser un decimal entre 0 y 100, con hasta dos decimales.');
  if (settings.catalog.length > 1000) issues.push('El catálogo admite hasta 1000 plantillas.');
  const ids = new Set<string>();
  settings.catalog.forEach((template, index) => {
    if (!template.id || ids.has(template.id))
      issues.push(`Plantilla ${index + 1}: identificador duplicado o vacío.`);
    ids.add(template.id);
    if (!template.name.trim() || !template.unit.trim())
      issues.push(`Plantilla ${index + 1}: completa nombre y unidad.`);
    if (
      validateQuote({
        currency: 'EUR',
        lines: [{ ...template, quantity: '1', discount: { kind: 'none' } }],
      }).length
    )
      issues.push(`Plantilla ${index + 1}: revisa precio, periodicidad y tipo de IVA.`);
    if (template.vat.kind !== 'taxed' && !template.vat.note.trim())
      issues.push(`Plantilla ${index + 1}: indica el motivo de exención o no sujeción.`);
  });
  return issues;
}

export function readStoredSettings(value: unknown): AppSettings {
  const settings = value as AppSettings;
  try {
    if (
      settings.id !== 'app' ||
      settings.schemaVersion !== 1 ||
      !Number.isSafeInteger(settings.revision) ||
      settings.revision < 1 ||
      typeof settings.updatedAt !== 'string'
    )
      throw new Error();
    const fields = [
      settings.issuer.name,
      settings.issuer.taxId,
      settings.issuer.address,
      settings.issuer.phone,
      settings.issuer.email,
      settings.brand.name,
      settings.payment.method,
      settings.payment.holder,
      settings.payment.iban,
      settings.payment.instructions,
      settings.conditions.terms,
      settings.conditions.notes,
    ];
    if (
      fields.some((field) => typeof field !== 'string') ||
      typeof settings.conditions.includesFirstMonthlyPayment !== 'boolean' ||
      !Array.isArray(settings.catalog)
    )
      throw new Error();
    if (
      settings.catalog.some((item) =>
        [item.id, item.name, item.description, item.unit, item.unitPrice].some(
          (field) => typeof field !== 'string',
        ),
      )
    )
      throw new Error();
    if (settingsIssues(settings).length) throw new Error();
    return structuredClone(settings);
  } catch {
    throw new Error(
      'La configuración almacenada tiene una estructura no compatible. Se conserva sin modificar.',
    );
  }
}
