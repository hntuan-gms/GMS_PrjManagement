import type { RequestAuth } from "./auth/middleware.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth; present on every route behind it. */
      auth?: RequestAuth;
    }
  }
}

export {};
