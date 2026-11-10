import type { NextResponse } from 'next/server';
import { currentUserId } from './session';
import { errorResponse, jsonError } from './http';

type Params = Record<string, string>;

/**
 * Wraps a route so that the viewer is resolved, domain errors become stable responses, and handlers
 * only contain their own logic. Authorisation still happens in the services the handler calls.
 */
export function viewerRoute<P extends Params>(
  name: string,
  handler: (args: { userId: string; params: P; request: Request }) => Promise<NextResponse>,
) {
  return async (request: Request, context: { params: Promise<P> }): Promise<NextResponse> => {
    const userId = await currentUserId();
    if (!userId) {
      return jsonError('UNAUTHENTICATED', 'Choose a demo account to continue.', 401);
    }
    try {
      const params = await context.params;
      return await handler({ userId, params, request });
    } catch (error: unknown) {
      return errorResponse(error, name);
    }
  };
}
