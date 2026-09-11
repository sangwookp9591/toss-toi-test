import {build} from '../node_modules/esbuild/lib/main.js';
await build({stdin:{contents:`export {init,parse} from 'es-module-lexer';export {default as MagicString} from 'magic-string';export {TraceMap,originalPositionFor} from '@jridgewell/trace-mapping';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',outfile:'tools.js'});
