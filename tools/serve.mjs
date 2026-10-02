// Static server that applies _headers the way Cloudflare does, so browser QA
// runs under the same security headers (including the CSP) as the deployment.
//   node tools/serve.mjs [root=.] [port=8812]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 8812);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv', '.zip': 'application/zip' };

// Only the "/*" block is used; that is all _headers defines.
const headers = {};
const hp = path.join(root, '_headers');
if (fs.existsSync(hp)) for (const line of fs.readFileSync(hp, 'utf8').split('\n')) {
  const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
  if (m) headers[m[1]] = m[2].trim();
}

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (path.basename(file) === '_headers' || !fs.existsSync(file)) { res.writeHead(404, headers); return res.end('Not found'); }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port} with ${Object.keys(headers).length} headers`));
