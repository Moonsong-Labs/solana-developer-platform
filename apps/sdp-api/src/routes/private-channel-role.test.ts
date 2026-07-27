import {
  PRIVATE_CHANNEL_ASSIGNABLE_ROLE_VALUES,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLE_VALUES,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
} from "@sdp/types";
import { describe, expect, it } from "vitest";

describe("Private Channel membership roles", () => {
  it("exposes owner, admin, member, and viewer role values", () => {
    expect(PRIVATE_CHANNEL_MEMBERSHIP_ROLES).toEqual({
      OWNER: "owner",
      ADMIN: "admin",
      MEMBER: "member",
      VIEWER: "viewer",
    });
    expect(PRIVATE_CHANNEL_MEMBERSHIP_ROLE_VALUES).toEqual(["owner", "admin", "member", "viewer"]);
    expect(PRIVATE_CHANNEL_ASSIGNABLE_ROLE_VALUES).toEqual(["admin", "member", "viewer"]);
  });
});
