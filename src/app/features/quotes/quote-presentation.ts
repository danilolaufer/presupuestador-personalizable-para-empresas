import type { QuoteStatus } from '../../domain/quotes/quote';
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
};
export function formatQuoteMoney(value: string): string {
  const [integer, fraction = ''] = value.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction.padEnd(2, '0')} €`;
}
