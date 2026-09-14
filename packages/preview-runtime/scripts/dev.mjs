import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from './build.mjs';
import { build as bundle } from 'esbuild';
import { previewHostPattern, previewDocument, studioHeaders } from '../../../apps/studio/scripts/security.mjs';
const ctx = await build(true);
// Local, pinned React fixture; no public CDN dependencies in runtime tests.
const require = createRequire(new URL('../../../apps/studio/package.json', import.meta.url));
const fixtureModules = { react: 'react', 'react-dom-client': 'react-dom/client', 'react-jsx-runtime': 'react/jsx-runtime' };
await bundle({ entryPoints: Object.fromEntries(Object.keys(fixtureModules).map(name => [name, 'fixture:' + name])),
  bundle: true, splitting: true, format: 'esm', platform: 'browser', outdir: 'dist/__runtime_fixture__', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'local-react-fixture', setup(build) {
    build.onResolve({filter: /^fixture:/}, args => ({path: args.path.slice(8), namespace:'fixture'}));
    build.onLoad({filter: /.*/, namespace:'fixture'}, args => {
      const name = fixtureModules[args.path]; const module = require(name);
      const exports = Object.keys(module).filter(key => /^[a-zA-Z_$][\w$]*$/.test(key) && key !== 'default');
      return { contents: 'import value from ' + JSON.stringify(require.resolve(name)) + '; export default value; export const {' + exports.join(',') + '} = value;', loader:'js', resolveDir:process.cwd() };
    });
  } }],
});
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json' };
const studioPort = Number(process.env.STUDIO_PORT ?? 5273);
const previewPort = Number(process.env.PREVIEW_PORT ?? 5274);
const servers = [studioPort, previewPort].map(port => createServer(async (req, res) => {
  if (port === previewPort && !previewHostPattern.test(req.headers.host ?? '')) { res.writeHead(421).end(); return; }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (port === previewPort && !['/frame.html', '/frame.js'].includes(pathname)) { res.writeHead(404).end(); return; }
  if (port === studioPort && ['/frame.html', '/frame.js'].includes(pathname)) { res.writeHead(404).end(); return; }
  const route = pathname === '/' ? 'demo/index.html' : pathname === '/frame.html' ? 'public/frame.html' : 'dist' + pathname;
  const path = resolve(route);
  if (!path.startsWith(resolve('.') + '/')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    if (pathname === '/frame.html') { const document = previewDocument(body.toString()); res.writeHead(200, document.headers).end(document.body); return; }
    res.writeHead(200, { ...(port === studioPort ? studioHeaders : {}), 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Runtime fixture server ${port}`)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { for (const server of servers) server.close(); await ctx.dispose(); process.exit(0); });
