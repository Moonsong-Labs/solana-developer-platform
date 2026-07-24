import {
  PRIVATE_CHANNEL_MEMBERSHIP_ROLE_VALUES,
  PRIVATE_CHANNEL_MEMBERSHIP_ROLES,
} from "@sdp/types";
import { describe, expect, it } from "vitest";

describe("Private Channel membership roles", () => {
  it("exposes only admin and member role values", () => {
    expect(PRIVATE_CHANNEL_MEMBERSHIP_ROLES).toEqual({
      ADMIN: "admin",
      MEMBER: "member",
    });
    expect(PRIVATE_CHANNEL_MEMBERSHIP_ROLE_VALUES).toEqual(["admin", "member"]);
  });
});
