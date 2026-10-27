import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't forward a rejected promise from an async handler to the
// error middleware on its own — it becomes an unhandled rejection and can
// crash the process. Wrap every async route with this so a thrown/rejected
// error reaches `next(err)` instead.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
