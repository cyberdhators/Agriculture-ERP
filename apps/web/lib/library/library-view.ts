import type { Role } from '@/lib/preview';

/**
 * WHO MAY SEE AN UNPUBLISHED LEARNING RESOURCE.
 *
 * This module is deliberately one rule. The learning library already has its
 * labels in `lib/format` (`TOPIC_LABELS`, `CROP_LABELS`, `LANGUAGE_LABELS`,
 * `FORMAT_LABELS`, `formatBytes`), its write gate in `lib/preview` (`canEdit`)
 * and its search helper in `components/library/resource-presentation`. Adding
 * second copies of those here would have been duplication dressed as a
 * redesign, so they are reused where they are.
 *
 * WHAT WAS ACTUALLY WRONG. `GET /api/learning-resources` adds
 * `published = true` for any caller whose scope is not `all`, and only an
 * ADMINISTRATOR has that scope — a supervisor's scope is `state`. The shared
 * `canSeeHidden` helper answers admin OR supervisor, so the library offered a
 * supervisor a "Show unpublished" switch the server could never satisfy: the
 * control did nothing, and the screen's own description said supervisors could
 * see drafts. This states the route's real rule.
 *
 * `canSeeHidden` itself is left alone on purpose. The directories screen uses
 * it against a route with the identical mismatch, and Directory is out of
 * scope for this work — reported rather than changed.
 */
export const canSeeUnpublished = (role: Role): boolean => role === 'admin';
