/**
 * Types for rendering secret-scan findings as locations. The implementation is
 * `.mjs` so the CI step can run it on the runner's preinstalled Node with no
 * loader.
 */
export interface GitleaksFinding {
  readonly RuleID?: string;
  readonly File?: string;
  readonly StartLine?: number;
  readonly EndLine?: number;
  readonly Commit?: string;
  readonly Fingerprint?: string;
  /** Carries the matched value. Never rendered. */
  readonly Secret?: string;
  readonly Match?: string;
  readonly Line?: string;
}
export declare const FORBIDDEN_FIELDS: readonly string[];
export declare function locationOf(finding: GitleaksFinding): {
  rule: string;
  file: string;
  startLine: number | null;
  endLine: number | null;
  commit: string;
  fingerprint: string;
};
export declare function formatFindings(findings: readonly GitleaksFinding[]): string;
export declare function mentionsNoSecretField(
  rendered: string,
  report: readonly GitleaksFinding[],
): boolean;
