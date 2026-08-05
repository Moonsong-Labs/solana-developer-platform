import { describe, expect, it, vi } from "vitest";
import type { ApiKeyContext } from "@/lib/auth";
import { resolveEventViewerForAuth } from "./event-access";

const PROJECT_ID = "prj_event_access";

function auth(overrides: Partial<ApiKeyContext> = {}): ApiKeyContext {
  return {
    id: "usr_event_access",
    organizationId: "org_event_access",
    projectId: PROJECT_ID,
    role: "member",
    permissions: ["payments:read"],
    environment: "dashboard",
    signingWalletId: null,
    signingWalletIds: [],
    walletBindings: [],
    authType: "session",
    userId: "usr_event_access",
    apiKeyId: null,
    ...overrides,
  };
}

function dependencies() {
  return {
    findPrivateChannelUser: vi.fn(),
    listVerifiedWallets: vi.fn(),
  };
}

describe("resolveEventViewerForAuth", () => {
  it("gives API keys full event visibility", async () => {
    const deps = dependencies();

    const viewer = await resolveEventViewerForAuth(
      auth({
        authType: "api_key",
        userId: null,
        apiKeyId: "key_event_access",
      }),
      PROJECT_ID,
      deps
    );

    expect(viewer).toEqual({ scope: "all" });
    expect(deps.findPrivateChannelUser).not.toHaveBeenCalled();
  });

  it("gives organization admins full event visibility", async () => {
    const deps = dependencies();

    const viewer = await resolveEventViewerForAuth(
      auth({ permissions: ["payments:read", "org:admin"] }),
      PROJECT_ID,
      deps
    );

    expect(viewer).toEqual({ scope: "all" });
    expect(deps.findPrivateChannelUser).not.toHaveBeenCalled();
  });

  it("limits ordinary members to their verified wallet pubkeys", async () => {
    const deps = dependencies();
    deps.findPrivateChannelUser.mockResolvedValue({ id: "pcu_event_access" });
    deps.listVerifiedWallets.mockResolvedValue([{ pubkey: "wallet-a" }, { pubkey: "wallet-b" }]);

    const viewer = await resolveEventViewerForAuth(auth(), PROJECT_ID, deps);

    expect(viewer).toEqual({ scope: "wallets", wallets: ["wallet-a", "wallet-b"] });
    expect(deps.findPrivateChannelUser).toHaveBeenCalledWith(
      { organizationId: "org_event_access", projectId: PROJECT_ID },
      "usr_event_access"
    );
    expect(deps.listVerifiedWallets).toHaveBeenCalledWith(
      { organizationId: "org_event_access", projectId: PROJECT_ID },
      "pcu_event_access"
    );
  });

  it("returns no visibility when the user is not a Private Channels member", async () => {
    const deps = dependencies();
    deps.findPrivateChannelUser.mockResolvedValue(null);

    const viewer = await resolveEventViewerForAuth(auth(), PROJECT_ID, deps);

    expect(viewer).toEqual({ scope: "none" });
    expect(deps.listVerifiedWallets).not.toHaveBeenCalled();
  });

  it("returns no visibility when the member has no verified wallets", async () => {
    const deps = dependencies();
    deps.findPrivateChannelUser.mockResolvedValue({ id: "pcu_event_access" });
    deps.listVerifiedWallets.mockResolvedValue([]);

    const viewer = await resolveEventViewerForAuth(auth(), PROJECT_ID, deps);

    expect(viewer).toEqual({ scope: "none" });
  });
});
