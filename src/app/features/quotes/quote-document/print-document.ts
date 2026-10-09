/** Espera fuentes, imágenes y un fotograma de composición antes del diálogo nativo. */
export async function prepareDocumentPrint(
  element: HTMLElement,
  document: Document,
): Promise<void> {
  if (document.fonts) await document.fonts.ready;
  await Promise.all(
    Array.from(element.querySelectorAll('img')).map(
      (image) =>
        new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            image.removeEventListener('load', loaded);
            image.removeEventListener('error', failed);
          };
          const loaded = () => {
            finish();
            image.naturalWidth && image.naturalHeight
              ? resolve()
              : reject(new Error('El logo no se puede mostrar.'));
          };
          const failed = () => {
            finish();
            reject(new Error('No se pudo cargar el logo. Reintenta antes de imprimir.'));
          };
          const timer = setTimeout(failed, 10000);
          if (image.complete) loaded();
          else {
            image.addEventListener('load', loaded, { once: true });
            image.addEventListener('error', failed, { once: true });
          }
        }),
    ),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
