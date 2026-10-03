/**
 * Types for the changed-scope decision. The implementation is `.mjs` because the
 * CI `scope` job runs it as plain `node scripts/ci-changed-scope.mjs` on the
 * runner's preinstalled Node, before dependencies are installed -- a TypeScript
 * loader there would mean installing the toolchain to answer a question about a
 * file list.
 */
export declare function isDocumentsOnly(changedPaths: readonly string[]): boolean;
export declare function pathsOutsideDocuments(changedPaths: readonly string[]): string[];
export declare function groupFor(changedPaths: readonly string[], uniqueGroup: string): string;
export declare const STAGING_GROUP: string;
