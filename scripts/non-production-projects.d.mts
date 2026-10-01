/**
 * Types for the closed allowlist. The implementation is `.mjs` so that plain
 * `node` scripts can import it without a TypeScript loader -- `pnpm db:reset`
 * runs as `node scripts/db-reset.mjs` with no loader, and adding one to a
 * destructive script to satisfy a type system would be the wrong trade.
 */
export declare const NON_PRODUCTION_PROJECT_REFS: readonly string[];
export declare function allNamesAllowed(
  connectionStrings: readonly (string | undefined)[],
): boolean;
export declare function namesNotAllowed(named: Record<string, string | undefined>): string[];
