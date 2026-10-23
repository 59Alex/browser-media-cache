import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const demo = new URL('../demo/', import.meta.url);
const port = Number(process.env.PORT ?? 4173);
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/bundle.js', ['bundle.js', 'text/javascript; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const route = routes.get(path);
  if (!route) { response.writeHead(404); response.end('Not found'); return; }
  try {
    const body = await readFile(fileURLToPath(new URL(route[0], demo)));
    response.writeHead(200, { 'content-type': route[1], 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(500); response.end('Build the demo first: npm run demo:build');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${server.address().port}`));
