import type { Permission } from "@sdp/types";
import { describe, expect, it } from "vitest";
import { hasProjectAdminAccess } from "./authorization";
import type { AppContext } from "./context";

function contextWithPermissions(permissions: Permission[]): AppContext {
  return {
    get(key: string) {
      if (key === "apiKey") {
        return {
          id: "key_test",
          organizationId: "org_test",
          projectId: "prj_test",
          role: "api_developer",
          permissions,
          environment: "sandbox",
        };
      }
      return undefined;
    },
  } as unknown as AppContext;
}

describe("Private Channels authorization", () => {
  it("recognizes projects:admin and wildcard as project-admin access", () => {
    expect(hasProjectAdminAccess(contextWithPermissions(["projects:admin"]))).toBe(true);
    expect(hasProjectAdminAccess(contextWithPermissions(["*"]))).toBe(true);
    expect(hasProjectAdminAccess(contextWithPermissions(["payments:write"]))).toBe(false);
  });
});
