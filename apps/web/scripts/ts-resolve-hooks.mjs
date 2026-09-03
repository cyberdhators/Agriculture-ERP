import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath, extname } from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('.') &&
    extname(specifier) === '' &&
    context.parentURL?.startsWith('file:')
  ) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolvePath(base, 'index.ts')]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
