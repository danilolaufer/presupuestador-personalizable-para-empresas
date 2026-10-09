export const MAX_LOGO_BYTES = 300 * 1024;
const types = ['image/png', 'image/jpeg', 'image/webp'];

function signature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  if (type === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

export function isValidLogoDataUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length > (MAX_LOGO_BYTES * 4) / 3 + 64) return false;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    return bytes.length > 0 && bytes.length <= MAX_LOGO_BYTES && signature(bytes, match[1]);
  } catch {
    return false;
  }
}

export async function readLogoFile(file: File): Promise<string> {
  if (!types.includes(file.type) || !file.size || file.size > MAX_LOGO_BYTES)
    throw new Error('Elige un PNG, JPEG o WebP de hasta 300 KiB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'));
    reader.readAsDataURL(file);
  });
  if (!isValidLogoDataUrl(dataUrl))
    throw new Error('El contenido del archivo no corresponde a una imagen admitida.');
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      image.naturalWidth && image.naturalHeight
        ? resolve()
        : reject(new Error('La imagen está vacía.'));
    image.onerror = () => reject(new Error('No se puede decodificar la imagen.'));
    image.src = dataUrl;
  });
  return dataUrl;
}
