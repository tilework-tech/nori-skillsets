/**
 * Tests for registry-install CLI command
 */

import * as fs from "fs/promises";

import * as clack from "@clack/prompts";
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
  NetworkError: class NetworkError extends Error {
    readonly isNetworkError = true;
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
      this.name = "NetworkError";
    }
  },
  ApiError: class ApiError extends Error {
    readonly isApiError = true;
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("fs/promises", () => ({
  access: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("@/cli/commands/registry-download/registryDownload.js", () => ({
  registryDownloadMain: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/cli/commands/install/install.js", () => ({
  main: vi.fn(),
}));

vi.mock("@/cli/commands/install/installState.js", () => ({
  hasExistingInstallation: vi.fn(() => false),
}));

vi.mock("@/cli/config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue(null),
  getDefaultAgents: vi.fn().mockReturnValue(["claude-code"]),
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

vi.mock("@clack/prompts", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
    message: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: "",
  })),
  confirm: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(),
}));

vi.mock("@/cli/logger.js", () => ({
  debug: vi.fn(),
  setSilentMode: vi.fn(),
  isSilentMode: vi.fn(),
}));

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
    });

    // Step 1: Download profile from registry - should use home dir as default
    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "senior-swe",
      installDir: "/mock-home",
      registryUrl: null,
      listVersions: null,
    });

    // Step 2: Initial install with the downloaded profile - should use home dir
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
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
    });

    expect(hasExistingInstallation).toHaveBeenCalledWith();

    // Step 1: Download profile from registry - should use home dir as default
    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "senior-swe",
      installDir: "/mock-home",
      registryUrl: null,
      listVersions: null,
    });

    // Step 3: Switch to downloaded profile
    expect(mockSwitchProfile).toHaveBeenCalledWith({
      installDir: "/mock-home",
      profileName: "senior-swe",
    });

    // Step 4: Regenerate files
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      agent: "claude-code",
      silent: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("should install to the user home directory by default", async () => {
    await registryInstallMain({
      packageSpec: "product-manager",
    });

    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "product-manager",
      installDir: "/mock-home",
      registryUrl: null,
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
    });

    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "documenter@2.1.0",
      installDir: "/mock-home",
      registryUrl: null,
      listVersions: null,
    });

    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      profile: "documenter",
      agent: "claude-code",
      silent: null,
    });
  });

  it("should not proceed with install if download fails", async () => {
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({ success: false });

    const result = await registryInstallMain({
      packageSpec: "nonexistent-profile",
    });

    // Download was attempted - should use home dir as default
    expect(registryDownloadMain).toHaveBeenCalledWith({
      packageSpec: "nonexistent-profile",
      installDir: "/mock-home",
      registryUrl: null,
      listVersions: null,
    });

    // Install should NOT have been called
    expect(installMain).not.toHaveBeenCalled();
    expect(mockSwitchProfile).not.toHaveBeenCalled();

    // Should return failure
    expect(result.success).toBe(false);
  });

  it("should display success message when install completes", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // Should display success message with profile name via clack
    expect(clack.log.success).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
    );
    expect(clack.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Restart"),
    );
  });

  it("should not display success message when download fails", async () => {
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({ success: false });

    await registryInstallMain({
      packageSpec: "nonexistent-profile",
    });

    // Should NOT display success message
    expect(clack.log.success).not.toHaveBeenCalled();
  });

  it("should fallback to local profile when download fails but profile exists locally", async () => {
    // Download fails
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({ success: false });
    // Local profile exists
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    // Has existing installation
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // Should warn about using local profile via clack
    expect(clack.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
    );
    expect(clack.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("local"),
    );

    // Should still switch profile and complete installation - using home dir
    expect(mockSwitchProfile).toHaveBeenCalledWith({
      installDir: "/mock-home",
      profileName: "senior-swe",
    });

    // Should return success
    expect(result.success).toBe(true);
  });

  it("should fail when download fails and profile does not exist locally", async () => {
    // Download fails
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({ success: false });
    // Local profile does NOT exist
    vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

    const result = await registryInstallMain({
      packageSpec: "nonexistent-profile",
    });

    // Should NOT switch profile or install
    expect(mockSwitchProfile).not.toHaveBeenCalled();
    expect(installMain).not.toHaveBeenCalled();

    // Should return failure
    expect(result.success).toBe(false);
  });
});
