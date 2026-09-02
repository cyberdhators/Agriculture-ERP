import { z } from 'zod';

import { phoneSchema } from './phone';

/**
 * DELETED IN B3, together with the route that uses it.
 *
 * This is the request schema for POST /api/_dev/validate-phone, which exists
 * only to prove that docs/api/CONVENTIONS.md and packages/shared agree inside
 * a running server, before requireRole exists.
 *
 * It is listed in the outstanding items section of docs/PROJECT-STATE.md.
 * Delete both together.
 */
export const devValidatePhoneBodySchema = z.strictObject({
  phone: phoneSchema,
});
