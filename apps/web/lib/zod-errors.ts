/**
 * Flattens a Zod failure into { fieldName: firstMessage }. The messages are
 * the ones defined in packages/shared, so a form shows exactly the sentence
 * the API would return for the same input.
 */
export function issuesByField(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}
