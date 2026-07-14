import { describe, expect, it } from "vitest";
import { SANDBOX_DEFAULTS } from "./constants";
import { privateChannelInstanceInputSchema } from "./schema";

describe("privateChannelInstanceInputSchema", () => {
  it("accepts the sandbox defaults", () => {
    const result = privateChannelInstanceInputSchema.safeParse(SANDBOX_DEFAULTS);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.gatewayUrl).toBe(SANDBOX_DEFAULTS.gatewayUrl);
    expect(result.data.useAuth).toBe(false);
    expect(result.data.authUrl).toBe("");
  });

  it("rejects an empty gateway URL", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      gatewayUrl: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fieldErrors = result.error.flatten().fieldErrors;
    expect(fieldErrors.gatewayUrl?.[0]).toMatch(/required/i);
  });

  it("rejects a non-http protocol for the devnet RPC URL", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      chainRpcUrl: "ftp://example.com",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.chainRpcUrl?.[0]).toMatch(/http\/https/i);
  });

  it("rejects an escrow program ID that is not base58", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      escrowProgramId: "not-a-base58-address",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.escrowProgramId?.[0]).toMatch(/base58/i);
  });

  it("requires authUrl when useAuth is true", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      useAuth: true,
      authUrl: "",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.authUrl?.[0]).toMatch(/required/i);
  });

  it("normalizes authUrl to empty string when useAuth is false", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      useAuth: false,
      authUrl: "http://ignored:8903",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.authUrl).toBe("");
  });

  it("accepts a valid useAuth + authUrl pair", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      useAuth: true,
      authUrl: "http://auth.test:8903",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.useAuth).toBe(true);
    expect(result.data.authUrl).toBe("http://auth.test:8903");
  });

  it("trims whitespace-only values into empty errors", () => {
    const result = privateChannelInstanceInputSchema.safeParse({
      ...SANDBOX_DEFAULTS,
      escrowInstanceAddr: "   ",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.escrowInstanceAddr?.[0]).toMatch(/required/i);
  });
});
