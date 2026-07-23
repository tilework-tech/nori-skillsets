/**
 * Tests for registry-install CLI command
 */

import * as fs from "fs/promises";

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInstallLock = vi.hoisted(() => {
  let active = false;
  return {
    reset: () => {
      active = false;
    },
    withInstallLock: vi.fn(
      async <T>(args: { operation: () => Promise<T> }): Promise<T> => {
        if (active) {
          throw new Error("Another Nori installation is already in progress");
        }
        active = true;
        try {
          return await args.operation();
        } finally {
          active = false;
        }
      },
    ),
  };
});

vi.mock("@/cli/features/install/installLock.js", () => ({
  withInstallLock: mockInstallLock.withInstallLock,
}));

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
  stat: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

vi.mock("@/cli/commands/registry-download/registryDownload.js", () => ({
  registryDownloadMain: vi
    .fn()
    .mockResolvedValue({ success: true, cancelled: false, message: "" }),
}));

vi.mock("@/cli/features/install/install.js", () => ({
  main: vi.fn(),
}));

vi.mock("@/cli/features/install/installState.js", () => ({
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
  bold: vi.fn(({ text }: { text: string }) => `**${text}**`),
  brightCyan: vi.fn(({ text }: { text: string }) => text),
  green: vi.fn(({ text }: { text: string }) => text),
}));

import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { loadConfig, updateConfig } from "@/cli/config.js";
import { main as installMain } from "@/cli/features/install/install.js";
import { hasExistingInstallation } from "@/cli/features/install/installState.js";
import { bold } from "@/cli/logger.js";

import { registryInstallMain } from "./registryInstall.js";

describe("registry-install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallLock.reset();
  });

  it("rejects a concurrent registry transaction while its download is still running", async () => {
    let releaseDownload!: () => void;
    let markDownloadStarted!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    const downloadCanFinish = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    vi.mocked(registryDownloadMain).mockImplementationOnce(async () => {
      markDownloadStarted();
      await downloadCanFinish;
      return { success: true, cancelled: false, message: "" };
    });

    const first = registryInstallMain({ packageSpec: "senior-swe" });
    await downloadStarted;

    try {
      await expect(
        registryInstallMain({ packageSpec: "product-manager" }),
      ).rejects.toThrow(/another Nori installation is already in progress/i);
    } finally {
      releaseDownload();
      await first;
    }
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
      nonInteractive: null,
      silent: null,
    });

    // Step 2: Initial install with the downloaded skillset - should use home dir
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      skillset: "public/senior-swe",
      agent: "claude-code",
      silent: null,
      persistActiveSkillset: true,
    });

    // Should NOT call switchSkillset or second install (initial install handles it)
    expect(mockSwitchSkillset).not.toHaveBeenCalled();
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("should not persist global activeSkillset for a transient --install-dir install", async () => {
    // An explicit --install-dir makes the install transient; it must not clobber
    // the user's global activeSkillset. Pass the flag through to installMain.
    await registryInstallMain({
      packageSpec: "senior-swe",
      installDir: "/custom/worktree",
    });

    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({ persistActiveSkillset: false }),
    );
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
      nonInteractive: null,
      silent: null,
    });

    // Step 3: Switch to downloaded skillset
    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({
        installDir: "/mock-home",
        skillsetName: "public/senior-swe",
      }),
    );

    // Step 4: Regenerate files - must include skillset name
    expect(installMain).toHaveBeenCalledTimes(1);
    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      agent: "claude-code",
      silent: true,
      skillset: "public/senior-swe",
      persistActiveSkillset: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledTimes(1);
  });

  it("resolves a bare name against the configured defaultOrg for switch and install", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);
    vi.mocked(loadConfig).mockResolvedValueOnce({
      installDir: "/mock-home",
      defaultOrg: "myorg",
    } as never);

    await registryInstallMain({ packageSpec: "senior-swe" });

    // The bare name resolves to "myorg/senior-swe" for the local switch/install,
    // matching what the delegated download resolves to.
    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({ skillsetName: "myorg/senior-swe" }),
    );
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({ skillset: "myorg/senior-swe" }),
    );
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
      nonInteractive: null,
      silent: null,
    });

    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      skillset: "public/product-manager",
      agent: "claude-code",
      silent: null,
      persistActiveSkillset: true,
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
      nonInteractive: null,
      silent: null,
    });

    expect(installMain).toHaveBeenCalledWith({
      nonInteractive: true,
      installDir: "/mock-home",
      skillset: "public/documenter",
      agent: "claude-code",
      silent: null,
      persistActiveSkillset: true,
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
      nonInteractive: null,
      silent: null,
    });

    // Install should NOT have been called
    expect(installMain).not.toHaveBeenCalled();
    expect(mockSwitchSkillset).not.toHaveBeenCalled();

    // Should return failure
    expect(result.success).toBe(false);
  });

  it("should show switching note and return success on switch path for existing installation", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    expect(clack.note).toHaveBeenCalledWith(
      expect.stringContaining("senior-swe"),
      "Switching Skillset",
    );

    // Return status contains skillset name
    expect(result.success).toBe(true);
    expect(result.message).toContain("senior-swe");
  });

  it("should fallback to local skillset when download fails but skillset exists locally", async () => {
    // Download fails
    vi.mocked(registryDownloadMain).mockResolvedValueOnce({
      success: false,
      cancelled: false,
      message: "",
    });
    // Local profile exists in a storage bucket (resolveSkillsetDir probes via fs.stat)
    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
    } as never);
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
        skillsetName: "public/senior-swe",
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

  it("should check hasExistingInstallation before calling registryDownloadMain", async () => {
    // Simulate download side-effect: hasExistingInstallation returns false initially,
    // but would return true after download (as auto-init creates config).
    // The fix snapshots the value before download, so the first-time path is taken.
    const callOrder: Array<string> = [];

    vi.mocked(hasExistingInstallation).mockImplementation(() => {
      callOrder.push("hasExistingInstallation");
      return false;
    });

    vi.mocked(registryDownloadMain).mockImplementation(async () => {
      callOrder.push("registryDownloadMain");
      return { success: true, cancelled: false, message: "" };
    });

    await registryInstallMain({ packageSpec: "test-skillset" });

    // hasExistingInstallation must be called BEFORE registryDownloadMain
    const hasExistingIdx = callOrder.indexOf("hasExistingInstallation");
    const downloadIdx = callOrder.indexOf("registryDownloadMain");
    expect(hasExistingIdx).toBeLessThan(downloadIdx);

    // First-time path should be taken (installMain called, no switchSkillset)
    expect(installMain).toHaveBeenCalled();
    expect(mockSwitchSkillset).not.toHaveBeenCalled();
  });

  it("should return outro message with past tense and bolded skillset name on first-time install", async () => {
    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe(
      `Installed and activated skillset "${bold({ text: "public/senior-swe" })}"`,
    );
  });

  it("should return outro message with past tense and bolded skillset name on existing installation", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    const result = await registryInstallMain({
      packageSpec: "senior-swe",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe(
      `Installed and activated skillset "${bold({ text: "public/senior-swe" })}"`,
    );
  });

  it("should pass nonInteractive to registryDownloadMain", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
      nonInteractive: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledWith(
      expect.objectContaining({
        nonInteractive: true,
      }),
    );
  });

  it("should pass silent to registryDownloadMain", async () => {
    await registryInstallMain({
      packageSpec: "senior-swe",
      silent: true,
    });

    expect(registryDownloadMain).toHaveBeenCalledWith(
      expect.objectContaining({
        silent: true,
      }),
    );
  });

  it("should install a public/ skillset under its public/ namespace while passing the namespaced spec to download", async () => {
    await registryInstallMain({
      packageSpec: "public/senior-swe",
    });

    expect(registryDownloadMain).toHaveBeenCalledWith(
      expect.objectContaining({ packageSpec: "public/senior-swe" }),
    );
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({ skillset: "public/senior-swe" }),
    );
  });

  it("should record the qualified public name as the active skillset on the switch path", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);

    await registryInstallMain({
      packageSpec: "public/senior-swe",
    });

    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({ skillsetName: "public/senior-swe" }),
    );
    expect(updateConfig).toHaveBeenCalledWith({
      activeSkillset: "public/senior-swe",
    });
  });

  it("installs an explicit public/ skillset as public/ even when a defaultOrg is configured", async () => {
    vi.mocked(hasExistingInstallation).mockReturnValueOnce(true);
    vi.mocked(loadConfig).mockResolvedValueOnce({
      installDir: "/mock-home",
      defaultOrg: "myorg",
    } as never);

    await registryInstallMain({ packageSpec: "public/senior-swe" });

    // A configured defaultOrg must not reroute an explicit public/ install: the
    // qualified public name flows to the switch op, not myorg/senior-swe.
    expect(mockSwitchSkillset).toHaveBeenCalledWith(
      expect.objectContaining({ skillsetName: "public/senior-swe" }),
    );
  });

  it("should keep the org prefix so an org skillset installs under its nested name", async () => {
    await registryInstallMain({
      packageSpec: "myorg/senior-swe",
    });

    expect(registryDownloadMain).toHaveBeenCalledWith(
      expect.objectContaining({ packageSpec: "myorg/senior-swe" }),
    );
    expect(installMain).toHaveBeenCalledWith(
      expect.objectContaining({ skillset: "myorg/senior-swe" }),
    );
  });

  it("should fail without downloading when the skillset specification is malformed", async () => {
    const result = await registryInstallMain({
      packageSpec: "org/sub/package",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Invalid skillset specification");
    expect(registryDownloadMain).not.toHaveBeenCalled();
  });
});
