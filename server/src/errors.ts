/**
 * One error taxonomy for the whole API, replacing the six identical
 * `catch { res.status(502) }` blocks that used to live in routes/api.ts.
 *
 * The load-bearing distinction is 401 vs 403. Jira returns 401 for a dead token
 * (the client must re-login) and 403 for "your account may not do that" (the
 * client must show a message and stay logged in). Collapsing both into 502 is
 * what made every Jira problem look like a server outage.
 */
import type { NextFunction, Request, Response } from "express";
import { AtlassianAuthError } from "./auth/atlassian.js";
import { SessionTooLargeError } from "./auth/session.js";
import { JiraApiError } from "./jiraClient.js";

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "JIRA_REAUTH_REQUIRED"
  | "JIRA_FORBIDDEN"
  | "JIRA_SCOPE_MISSING"
  | "ISSUE_NOT_FOUND"
  | "JIRA_RATE_LIMITED"
  | "SESSION_TOO_LARGE"
  | "JIRA_UPSTREAM"
  | "NO_PROJECT_SELECTED"
  | "STAFF_ONLY"
  | "RESOURCES_ADMIN_ONLY"
  | "BAD_REQUEST"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const authRequired = () =>
  new AppError(401, "AUTH_REQUIRED", "Bạn cần đăng nhập bằng tài khoản Atlassian.");

export const noProjectSelected = () =>
  new AppError(409, "NO_PROJECT_SELECTED", "Chưa chọn dự án Jira.");

export const staffOnly = () =>
  new AppError(
    403,
    "STAFF_ONLY",
    "Tính năng trợ lý AI chỉ dành cho tài khoản nội bộ. Các tính năng còn lại vẫn dùng được bình thường."
  );

/**
 * The resource tab is only as accurate as the member list, and the member list
 * is only accurate for someone Jira lets read the project's roles. See
 * requireResourceAccess in routes/resources.ts.
 */
export const resourcesAdminOnly = () =>
  new AppError(
    403,
    "RESOURCES_ADMIN_ONLY",
    "Trang Nguồn lực chỉ dành cho người có quyền Administer Projects trên dự án này."
  );

export const badRequest = (message: string) => new AppError(400, "BAD_REQUEST", message);

export const notFound = (message: string) => new AppError(404, "ISSUE_NOT_FOUND", message);

interface Mapped {
  status: number;
  code: ErrorCode;
  error: string;
  retryAfter?: string;
}

function mapError(err: unknown): Mapped {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, error: err.message };
  }

  if (err instanceof SessionTooLargeError) {
    // Server-side bug (the sealed session blob grew past the cookie cap), not
    // something the user can fix by retrying — surface it as a real 500 so it
    // gets logged and alerted on, instead of being swallowed and disguised as
    // a silent, unexplained logout.
    return { status: 500, code: "SESSION_TOO_LARGE", error: err.message };
  }

  if (err instanceof AtlassianAuthError) {
    return {
      status: 401,
      code: "JIRA_REAUTH_REQUIRED",
      error: "Phiên Atlassian đã hết hạn. Vui lòng đăng nhập lại.",
    };
  }

  if (err instanceof JiraApiError) {
    // Checked before the 401 branch: the gateway reports a missing scope as a
    // 401, and mapping that to JIRA_REAUTH_REQUIRED logs the user out — into a
    // loop, since the fresh login's token carries the same scopes.
    if (err.scopeProblem) {
      return {
        status: 403,
        code: "JIRA_SCOPE_MISSING",
        error:
          "Ứng dụng chưa được cấp đủ quyền trên Atlassian cho thao tác này. " +
          "Cần đăng nhập lại để cấp quyền bổ sung.",
      };
    }
    // Same trap as the scope case: Jira sends "no Administer Projects" as a 401,
    // and treating it as a dead session would log a non-admin out for lacking a
    // permission — every time, since a new login has the same permissions.
    if (err.configRefused) {
      return {
        status: 403,
        code: "JIRA_FORBIDDEN",
        error: `Tài khoản của bạn không có quyền thực hiện thao tác này trên Jira. ${err.summary}`.trim(),
      };
    }
    if (err.status === 401) {
      return {
        status: 401,
        code: "JIRA_REAUTH_REQUIRED",
        error: "Jira từ chối phiên đăng nhập. Vui lòng đăng nhập lại.",
      };
    }
    if (err.status === 403) {
      return {
        status: 403,
        code: "JIRA_FORBIDDEN",
        error: `Tài khoản của bạn không có quyền thực hiện thao tác này trên Jira. ${err.summary}`.trim(),
      };
    }
    if (err.status === 404) {
      return {
        status: 404,
        code: "ISSUE_NOT_FOUND",
        error: `Không tìm thấy trên Jira. ${err.summary}`.trim(),
      };
    }
    if (err.status === 429) {
      return {
        status: 503,
        code: "JIRA_RATE_LIMITED",
        error: "Jira đang giới hạn tần suất truy cập. Vui lòng thử lại sau giây lát.",
        retryAfter: err.retryAfter ?? "5",
      };
    }
    return {
      status: 502,
      code: "JIRA_UPSTREAM",
      error: `Jira trả về lỗi ${err.status}. ${err.summary}`.trim(),
    };
  }

  return {
    status: 500,
    code: "INTERNAL",
    error: err instanceof Error ? err.message : "Lỗi không xác định.",
  };
}

// Four args is what marks this as Express error middleware; `_next` must stay.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const mapped = mapError(err);

  // Raw Jira bodies are useful in the log and noise (or a leak) in the browser.
  if (mapped.status >= 500 || mapped.code === "INTERNAL") {
    console.error("[api]", err);
  } else if (err instanceof JiraApiError) {
    console.warn(`[api] Jira ${err.status}: ${err.body.slice(0, 500)}`);
  }

  if (mapped.retryAfter) res.setHeader("Retry-After", mapped.retryAfter);
  if (res.headersSent) return;
  res.status(mapped.status).json({ error: mapped.error, code: mapped.code });
}
