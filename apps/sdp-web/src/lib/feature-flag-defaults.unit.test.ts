import { describe, expect, it } from "vitest";
import {
  getAssetProfilesDefault,
  getHomepageOpenSignupDefault,
  getPrivateChannelsDefault,
} from "./feature-flag-defaults";

describe("getHomepageOpenSignupDefault", () => {
  it("defaults Vercel production to the waitlist", () => {
    expect(getHomepageOpenSignupDefault({ vercelEnvironment: "production" })).toBe(false);
  });

  it.each([
    "preview",
    "development",
    undefined,
  ])("defaults %s deployments to open signup", (vercelEnvironment) => {
    expect(getHomepageOpenSignupDefault({ vercelEnvironment })).toBe(true);
  });
});

describe("getAssetProfilesDefault", () => {
  it.each([
    "preview",
    "development",
    " PREVIEW ",
  ])("enables the %s Vercel environment", (vercelEnvironment) => {
    expect(
      getAssetProfilesDefault({
        nodeEnvironment: "production",
        vercelEnvironment,
      })
    ).toBe(true);
  });

  it.each([
    "production",
    "staging",
    "unexpected",
  ])("fails closed for the %s Vercel environment", (vercelEnvironment) => {
    expect(
      getAssetProfilesDefault({
        nodeEnvironment: "development",
        vercelEnvironment,
      })
    ).toBe(false);
  });

  it("enables self-hosted development", () => {
    expect(
      getAssetProfilesDefault({
        nodeEnvironment: "production",
        sdpEnvironment: "development",
      })
    ).toBe(true);
  });

  it("keeps self-hosted production disabled", () => {
    expect(
      getAssetProfilesDefault({
        nodeEnvironment: "production",
        sdpEnvironment: "production",
      })
    ).toBe(false);
  });

  it("honors the server-only self-hosted production opt-in", () => {
    expect(
      getAssetProfilesDefault({
        assetProfilesEnabled: " TRUE ",
        nodeEnvironment: "production",
        sdpEnvironment: "production",
      })
    ).toBe(true);
  });

  it.each(["development", "test"])("enables local %s", (nodeEnvironment) => {
    expect(getAssetProfilesDefault({ nodeEnvironment })).toBe(true);
  });
});

describe("getPrivateChannelsDefault", () => {
  // Must accept exactly what the API's isTruthyFlag accepts, so the dashboard
  // and the API never disagree about whether the feature is on.
  it.each([
    "true",
    " TRUE ",
    "1",
    "yes",
    "on",
  ])("honors the %s server-side opt-in", (privateChannelsEnabled) => {
    expect(getPrivateChannelsDefault({ privateChannelsEnabled })).toBe(true);
  });

  it.each([
    "false",
    "0",
    "off",
    "unexpected",
    "",
    undefined,
  ])("fails closed for %s", (privateChannelsEnabled) => {
    expect(getPrivateChannelsDefault({ privateChannelsEnabled })).toBe(false);
  });
});
