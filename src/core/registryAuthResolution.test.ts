/**
 * Tests for org-scoped registry auth resolution (core).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { getRegistryAuthToken } from "@/api/registryAuth.js";
import { resolveOrgRegistryAuth } from "@/core/registryAuthResolution.js";

import type { AuthCredentials } from "@/api/authCredentials.js";

vi.mock("@/api/registryAuth.js", () => ({
  getRegistryAuthToken: vi.fn(),
}));

const memberAuth = (): AuthCredentials => ({
  username: "tester",
  organizationUrl: "https://myorg.nori-registry.ai",
  refreshToken: "rt-test",
  apiToken: null,
  organizations: ["myorg", "otherorg"],
});

describe("resolveOrgRegistryAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a member org with the derived registry URL and unified auth", () => {
    const result = resolveOrgRegistryAuth({
      auth: memberAuth(),
      orgId: "myorg",
    });

    expect(result.ok).toBe(true);
    expect(result.registryUrl).toBe("https://myorg.noriskillsets.dev");
    if (result.ok !== true) {
      throw new Error("expected ok result");
    }
    expect(result.registryAuth).toEqual({
      registryUrl: "https://myorg.noriskillsets.dev",
      username: "tester",
      refreshToken: "rt-test",
      apiToken: null,
    });
  });

  it("reports not-a-member (with the user's organizations) for an org outside the list", () => {
    const result = resolveOrgRegistryAuth({
      auth: memberAuth(),
      orgId: "strangerorg",
    });

    expect(result).toEqual({
      ok: false,
      reason: "not-a-member",
      registryUrl: "https://strangerorg.noriskillsets.dev",
      organizations: ["myorg", "otherorg"],
    });
  });

  it("reports no-unified-auth when there is no auth at all", () => {
    const result = resolveOrgRegistryAuth({ auth: null, orgId: "myorg" });

    expect(result).toEqual({
      ok: false,
      reason: "no-unified-auth",
      registryUrl: "https://myorg.noriskillsets.dev",
    });
  });

  it("reports no-unified-auth when auth has no organizations list", () => {
    const result = resolveOrgRegistryAuth({
      auth: { ...memberAuth(), organizations: null },
      orgId: "myorg",
    });

    expect(result).toEqual({
      ok: false,
      reason: "no-unified-auth",
      registryUrl: "https://myorg.noriskillsets.dev",
    });
  });

  it("getToken delegates to getRegistryAuthToken with the resolved registry auth", async () => {
    vi.mocked(getRegistryAuthToken).mockResolvedValue("token-abc");

    const result = resolveOrgRegistryAuth({
      auth: memberAuth(),
      orgId: "myorg",
    });
    if (result.ok !== true) {
      throw new Error("expected ok result");
    }

    await expect(result.getToken()).resolves.toBe("token-abc");
    expect(getRegistryAuthToken).toHaveBeenCalledTimes(1);
    expect(getRegistryAuthToken).toHaveBeenCalledWith({
      registryAuth: result.registryAuth,
    });
  });
});
