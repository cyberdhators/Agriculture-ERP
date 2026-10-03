/**
 * Types for the blocking scan's commit range. The implementation is `.mjs` so the
 * CI step can run it on the runner's preinstalled Node with no loader.
 */
export declare class UnresolvableRange extends Error {}
export declare function rangeFor(event: {
  event?: string;
  baseRef?: string;
  beforeSha?: string;
}): string;
