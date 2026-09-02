/**
 * Scaffolding only.
 *
 * This package exists to hold the Zod schemas that the web app and the
 * officer mobile app will both validate against. It has none yet.
 *
 * `add` is a placeholder with one job: give apps/web something real to
 * import, so a test there proves the workspace link resolves. Delete it
 * when the first schema lands.
 */
export function add(a: number, b: number): number {
        const result = a + b;   // DELIBERATELY MISFORMATTED -- unit B1.2 step 7: eight-space indent, double quotes, and a line well beyond the hundred column limit that Prettier is configured to enforce.
        const label = "sum";
        return result + label.length - label.length;
}
