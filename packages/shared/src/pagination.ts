import { z } from 'zod';

/**
 * Cursor pagination, per docs/api/CONVENTIONS.md section 6.
 *
 * Values arrive from a query string, so a limit may be a string or a number.
 * Asking for too many is not an error -- it is clamped. Asking for fewer than
 * one is an error, because it cannot be honoured.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export const PAGINATION_MESSAGES = {
  notANumber: 'The page size must be a number.',
  cursorNotText: 'The page marker must be text.',
  notWhole: 'The page size must be a whole number.',
  tooSmall: 'The page size must be at least 1.',
} as const;

const limitSchema = z
  .union([z.string(), z.number()], { error: () => PAGINATION_MESSAGES.notANumber })
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined) {
      return DEFAULT_LIMIT;
    }

    const parsed = typeof raw === 'number' ? raw : Number(raw.trim());

    if (typeof raw === 'string' && raw.trim() === '') {
      ctx.addIssue({ code: 'custom', message: PAGINATION_MESSAGES.notANumber });
      return z.NEVER;
    }
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: 'custom', message: PAGINATION_MESSAGES.notANumber });
      return z.NEVER;
    }
    if (!Number.isInteger(parsed)) {
      ctx.addIssue({ code: 'custom', message: PAGINATION_MESSAGES.notWhole });
      return z.NEVER;
    }
    if (parsed < 1) {
      ctx.addIssue({ code: 'custom', message: PAGINATION_MESSAGES.tooSmall });
      return z.NEVER;
    }

    // Clamped, deliberately, rather than rejected.
    return Math.min(parsed, MAX_LIMIT);
  });

export const paginationSchema = z.strictObject({
  cursor: z.string({ error: () => PAGINATION_MESSAGES.cursorNotText }).optional(),
  limit: limitSchema,
});

export type Pagination = z.infer<typeof paginationSchema>;
