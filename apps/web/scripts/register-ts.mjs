// Lets plain `node` import the app's TypeScript modules.
//
// packages/shared uses extensionless relative imports (`./phone`), which tsc,
// vitest and Next's bundler all resolve and Node's native ESM loader does not.
// B1.4 had to strip `.js` extensions because Next's webpack rejected them, so
// the two loaders cannot both be satisfied by the files themselves. This hook
// tries `.ts` for a relative specifier that has no extension. Node 24 strips
// the types once the file is found. No dependency added.
//
// Used only by scripts under apps/web/scripts that need the app's own modules.
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

register(pathToFileURL(fileURLToPath(new URL('./ts-resolve-hooks.mjs', import.meta.url))));
