import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Servidor local de comprobación, sin dependencias ni exposición a la red local.
const root = fileURLToPath(new URL('../dist/presupuestador/browser/', import.meta.url));
const port = Number(process.env['PREVIEW_PORT'] ?? 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
try {
  await stat(resolve(root, 'index.html'));
} catch {
  console.error('Falta dist/presupuestador/browser/index.html. Ejecuta npm run build.');
  process.exit(1);
}
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405);
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (!extname(file)) file = resolve(root, 'index.html'); // Rutas de Angular al recargar.
    const data = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    response.writeHead(404);
    response.end('No encontrado');
  }
}).listen(port, '127.0.0.1', () =>
  console.log(`Producción local: http://127.0.0.1:${port} (Ctrl+C para detener)`),
);
