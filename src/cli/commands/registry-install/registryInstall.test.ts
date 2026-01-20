/**
 * Tests for registry-install CLI command
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("os", async () => {
  const actual: any = await vi.importActual("os");
  return {
    ...actual,
    homedir: vi.fn(() => "/mock-home"),
  };
});

vi.mock("@/api/registrar.js", () => ({
  REGISTRAR_URL: "https://registrar.tilework.tech",
}));

vi.mock("@/cli/commands/registry-download/registryDownload.js", () => ({
  registryDownloadMain: vi.fn(),
}));

vi.mock("@/cli/commands/install/install.js", () => ({
  main: vi.fn(),
}));

vi.mock("@/cli/commands/install/installState.js", () => ({
  hasExistingInstallation: vi.fn(() => false),
}));

const mockSwitchProfile = vi.fn();

vi.mock("@/cli/features/agentRegistry.js", () => ({
  AgentRegistry: {
    getInstance: () => ({
      get: () => ({
        switchProfile: mockSwitchProfile,
      }),
    }),
  },
}));

import { REGISTRAR_URL } from "@/api/registrar.js";
import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";

import { registryInstallMain } from "./registryInstall.js";

describe("registry-install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should download profile first, then run install when no existing installation", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
      cwd: "/repo",
    });

    // Step 1: Download profile from registry first
    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "senior-swe",
      installDir: "/repo",
      registryUrl: REGISTRAR_URL,
      listVersions: null,
    });

    // Step 2: Initial install with the downloaded profile
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/repo",
      profile: "senior-swe",
      agent: "claude-code",
      silent: null,
    });

    // Should NOT call switchProfile or second install (initial install handles it)
    expect(mockSwitchProfile).not.toHaveBeenCalled();
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("should download profile, switch profile, and regenerate when existing installation detected", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    await registryInstallMain({
      packageSpec: "senior-swe",
      cwd: "/repo",
    });

    expect(hasExistingInstallation).toHaveBeenCalledWith({
      installDir: "/repo",
    });

    // Step 1: Download profile from registry
    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "senior-swe",
      installDir: "/repo",
      registryUrl: REGISTRAR_URL,
      listVersions: null,
    });

    // Step 3: Switch to downloaded profile
    expect(mockSwitchProfile).toHaveBeenCalledWith({
      installDir: "/repo",
      profileName: "senior-swe",
    });

    // Step 4: Regenerate files
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      skipUninstall: true,
      installDir: "/repo",
      agent: "claude-code",
      silent: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("should install to the user home directory when --user is set", async () => {
    await registryInstallMain({
      packageSpec: "product-manager",
      useHomeDir: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "product-manager",
      installDir: "/mock-home",
      registryUrl: REGISTRAR_URL,
      listVersions: null,
    });

    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      profile: "product-manager",
      agent: "claude-code",
      silent: null,
    });
  });

  it("should parse versioned package specs and use the profile name for install", async () => {
    await registryInstallMain({
      packageSpec: "documenter@2.1.0",
      cwd: "/repo",
    });

    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "documenter@2.1.0",
      installDir: "/repo",
      registryUrl: REGISTRAR_URL,
      listVersions: null,
    });

    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/repo",
      profile: "documenter",
      agent: "claude-code",
      silent: null,
    });
  });
});
