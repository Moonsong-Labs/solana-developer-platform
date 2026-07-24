import type { Permission } from "@sdp/types";
import { describe, expect, it } from "vitest";
import { isAdminTier } from "./authorization";
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
  it("treats projects:admin and wildcard permissions as admin tier", () => {
    expect(isAdminTier(contextWithPermissions(["projects:admin"]))).toBe(true);
    expect(isAdminTier(contextWithPermissions(["*"]))).toBe(true);
    expect(isAdminTier(contextWithPermissions(["payments:write"]))).toBe(false);
  });
});
