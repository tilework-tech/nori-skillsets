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
  updateConfig: vi.fn().mockResolvedValue(undefined),
  getActiveSkillset: vi.fn().mockReturnValue(null),
  getDefaultAgents: vi.fn().mockReturnValue(["claude-code"]),
}));

vi.mock("@/cli/features/agentRegistry.js", () => ({
  AgentRegistry: {
    getInstance: () => ({
      get: () => ({
        name: "claude-code",
      }),
      getAgentDirNames: () => [".claude"],
    }),
  },
}));

const mockSwitchSkillset = vi.fn();

vi.mock("@/cli/features/agentOperations.js", () => ({
  switchSkillset: (...args: Array<unknown>) => mockSwitchSkillset(...args),
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
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
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
  bold: vi.fn(({ text }: { text: string }) => text),
  brightCyan: vi.fn(({ text }: { text: string }) => text),
  green: vi.fn(({ text }: { text: string }) => text),
}));

import { main as installMain } from "@/cli/commands/install/install.js";
import { hasExistingInstallation } from "@/cli/commands/install/installState.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";

import { registryInstallMain } from "./registryInstall.js";

describe("registry-install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should download skillset first, then run install when no existing installation", async () => {
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

    // Step 2: Initial install with the downloaded skillset - should use home dir
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      skillset: "senior-swe",
      agent: "claude-code",
      silent: null,
    });

    // Should NOT call switchSkillset or second install (initial install handles it)
    expect(mockSwitchSkillset).not.toHaveBeenCalled();
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("should download skillset, switch skillset, and regenerate when existing installation detected", async () => {
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

    // Step 3: Switch to downloaded skillset
    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: "/mock-home",
        skillsetName: "senior-swe",
      }),
    );

    // Step 4: Regenerate files - must include skillset name
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      agent: "claude-code",
      silent: true,
      skillset: "senior-swe",
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
      skillset: "product-manager",
      agent: "claude-code",
      silent: null,
    });
  });

  it("should parse versioned package specs and use the skillset name for install", async () => {
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
      skillset: "documenter",
      agent: "claude-code",
      silent: null,
    });
  });

  it("should not proceed with install if download fails", async () => {
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "",
    });

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
    expect(mockSwitchSkillset).not.toHaveBeenCalled();

    // Should return failure
    expect(result.success).toBe(false);
  });

  it("should not display outro on initial install (installMain handles its own banners)", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // Initial install delegates to installMain which shows its own completion banners
    expect(clack.outro).not.toHaveBeenCalled();
  });

  it("should show switching note and return success on switch path for existing installation", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // Switch path shows note but no intro/outro
    expect(clack.intro).not.toHaveBeenCalled();
    expect(clack.note).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
      "Switching Skillset",
    );
    expect(clack.outro).not.toHaveBeenCalled();

    // Return status contains skillset name
    expect(result.success).toBe(true);
    expect(result.message).toContain("senior-swe");
  });

  it("should not display outro when download fails", async () => {
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "",
    });

    await registryInstallMain({
      packageSpec: "nonexistent-profile",
    });

    // Should NOT display outro
    expect(clack.outro).not.toHaveBeenCalled();
  });

  it("should fallback to local skillset when download fails but skillset exists locally", async () => {
    // Download fails
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "",
    });
    // Local profile exists
    vi.mocked(fs.access).mockResolvedValueOnce(undefined);
    // Has existing installation
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // Should warn about using local skillset via clack
    expect(clack.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
    );
    expect(clack.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("local"),
    );

    // Should still switch profile and complete installation - using home dir
    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: "/mock-home",
        skillsetName: "senior-swe",
      }),
    );

    // Should return success
    expect(result.success).toBe(true);
  });

  it("should fail when download fails and skillset does not exist locally", async () => {
    // Download fails
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "",
    });
    // Local profile does NOT exist
    vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

    const result = await registryInstallMain({
      packageSpec: "nonexistent-profile",
    });

    // Should NOT switch profile or install
    expect(mockSwitchSkillset).not.toHaveBeenCalled();
    expect(installMain).not.toHaveBeenCalled();

    // Should return failure
    expect(result.success).toBe(false);
  });

  it("should pass skipManifest to installMain when explicit installDir is provided", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
      installDir: "/tmp/explicit-dir",
    });

    // installMain should be called with skipManifest: true
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should NOT pass skipManifest to installMain when no explicit installDir is provided", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
    });

    // installMain should NOT have skipManifest: true
    expect(installMain).toHaveBeenCalledWith(
      expect.not.objectContaining({
        skipManifest: true,
      }),
    );
  });

  it("should pass skipManifest on existing installation switch path when explicit installDir is provided", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    await registryInstallMain({
      packageSpec: "senior-swe",
      installDir: "/tmp/explicit-dir",
    });

    // installMain should be called with skipManifest: true on the switch path
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({
        skipManifest: true,
      }),
    );
  });
});
