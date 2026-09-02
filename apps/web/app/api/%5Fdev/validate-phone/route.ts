import {
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_BODY_BYTES,
  apiError,
  devValidatePhoneBodySchema,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { NextResponse } from 'next/server';

/**
 * ============================================================================
 * THIS ROUTE IS DELETED IN B3. IT IS NOT A FEATURE.
 * ============================================================================
 *
 * It exists for one reason: to prove, inside a running server, that
 * docs/api/CONVENTIONS.md and the Zod schemas in packages/shared agree about
 * what a success and a failure look like. Nothing else uses it and nothing
 * else may.
 *
 * It is UNAUTHENTICATED, which every other route in this project is forbidden
 * to be. requireRole does not exist until B3. CONVENTIONS.md section 2 names
 * /api/_dev/* as the single enumerated exception to the rule that requireRole
 * runs before any data access, and this route is listed in the outstanding
 * items section of docs/PROJECT-STATE.md.
 *
 * When B3 lands: delete this file, delete devValidatePhoneBodySchema from
 * packages/shared/src/dev.ts, delete the tests, remove the entry from
 * PROJECT-STATE.md, and remove the exception paragraph from CONVENTIONS.md.
 *
 * It touches no database and stores nothing.
 */

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        apiError(ERROR_CODES.payloadTooLarge, ERROR_MESSAGES.payloadTooLarge),
        { status: 413 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // An unreadable body is the client's problem, not an internal failure.
      return NextResponse.json(apiError(ERROR_CODES.invalidJson, ERROR_MESSAGES.invalidJson), {
        status: 400,
      });
    }

    const parsed = devValidatePhoneBodySchema.safeParse(body);
    if (!parsed.success) {
      const { status, body: errorBody } = zodErrorToApiError(parsed.error);
      return NextResponse.json(errorBody, { status });
    }

    return NextResponse.json({ data: { phone: parsed.data.phone } }, { status: 200 });
  } catch {
    // Nothing internal reaches the caller. CONVENTIONS.md section 5.2.
    return NextResponse.json(apiError(ERROR_CODES.internalError, ERROR_MESSAGES.internalError), {
      status: 500,
    });
  }
}

/**
 * Next.js answers an unsupported method with a bare 405 and no body. That
 * contradicts CONVENTIONS.md section 5, which promises the documented error
 * shape with code `method_not_allowed` on every error without exception.
 *
 * These handlers make the document true for this route. B3 should replace them
 * with a shared route wrapper -- the same wrapper that will call requireRole --
 * so that every route gets this without repeating it.
 */
function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    apiError(ERROR_CODES.methodNotAllowed, ERROR_MESSAGES.methodNotAllowed),
    { status: 405 },
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
