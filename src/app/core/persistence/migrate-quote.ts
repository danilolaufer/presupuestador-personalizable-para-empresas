/** Añade campos, sin usar configuración ni alterar contenido, números, fechas o revisiones. */
export function migrateQuoteV1(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const quote = value as Record<string, unknown>;
  if (
    quote['schemaVersion'] !== 1 ||
    typeof quote['payment'] !== 'object' ||
    quote['payment'] === null
  )
    return value;
  return {
    ...quote,
    schemaVersion: 2,
    title: quote['title'] ?? '',
    payment: { holder: '', ...quote['payment'] },
  };
}
