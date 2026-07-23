/**
 * Behavior tests for transactional activation.
 *
 * These assert user-visible filesystem/config state before and after an
 * activation that fails partway through. The interior of the transaction
 * (how it stages backups) is treated as a black box.
 */

import * as fsSync from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateConfig } from "@/cli/config.js";
import {
  recoverPendingActivations,
  withActivationTransaction,
} from "@/cli/features/install/activationTransaction.js";

import type { AgentConfig, AgentLoader } from "@/cli/features/agentRegistry.js";

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: vi.fn().mockReturnValue(actual.homedir()) };
});

const createTestAgent = (args: {
  loaders: Array<AgentLoader>;
  externalSettingsFiles?: ReadonlyArray<string> | null;
}): AgentConfig => {
  const { loaders, externalSettingsFiles } = args;
  return {
    name: "claude-code",
    displayName: "Test Agent",
    supportTier: "experimental",
    capabilities: {
      mcp: false,
      hooks: false,
      statusline: false,
      transcripts: false,
    },
    description: "A test agent for transaction tests",
    getAgentDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent"),
    getSkillsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "skills"),
    getSubagentsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "agents"),
    getSlashcommandsDir: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "commands"),
    getInstructionsFilePath: (a: { installDir: string }) =>
      path.join(a.installDir, ".test-agent", "CLAUDE.md"),
    getLoaders: () => loaders,
    getExternalSettingsFiles:
      externalSettingsFiles != null ? () => externalSettingsFiles : null,
    getArtifactPatterns: null,
    getLegacyManifestPath: null,
  };
};

const agent = createTestAgent({
  loaders: [
    {
      name: "instr",
      description: "d",
      managedFiles: ["CLAUDE.md"],
      run: async () => undefined,
    },
    {
      name: "skills",
      description: "d",
      managedDirs: ["skills"],
      run: async () => undefined,
    },
  ],
});

let tempHome: string;
let installDir: string;
let agentDir: string;

const write = async (p: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
};
const read = (p: string): string | null =>
  fsSync.existsSync(p) ? fsSync.readFileSync(p, "utf-8") : null;

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "nori-txn-home-"));
  installDir = await fs.mkdtemp(path.join(os.tmpdir(), "nori-txn-install-"));
  agentDir = path.join(installDir, ".test-agent");
  vi.mocked(os.homedir).mockReturnValue(tempHome);
});

afterEach(async () => {
  await fs.rm(tempHome, { recursive: true, force: true });
  await fs.rm(installDir, { recursive: true, force: true });
});

describe("withActivationTransaction", () => {
  it("restores the previous managed files when the operation throws", async () => {
    // Previous usable state (skillset A).
    await write(path.join(agentDir, "CLAUDE.md"), "PROFILE A");
    await write(path.join(agentDir, "skills", "a.md"), "skill a");

    await expect(
      withActivationTransaction({
        installDir,
        agents: [agent],
        operation: async () => {
          await write(path.join(agentDir, "CLAUDE.md"), "PROFILE B");
          await write(path.join(agentDir, "skills", "b.md"), "skill b");
          await fs.rm(path.join(agentDir, "skills", "a.md"));
          throw new Error("agent 2 failed");
        },
      }),
    ).rejects.toThrow("agent 2 failed");

    expect(read(path.join(agentDir, "CLAUDE.md"))).toBe("PROFILE A");
    expect(read(path.join(agentDir, "skills", "a.md"))).toBe("skill a");
    expect(read(path.join(agentDir, "skills", "b.md"))).toBeNull();
  });

  it("deletes newly-created managed files when the operation throws", async () => {
    await write(path.join(agentDir, "CLAUDE.md"), "PROFILE A");

    await expect(
      withActivationTransaction({
        installDir,
        agents: [agent],
        operation: async () => {
          await write(path.join(agentDir, "skills", "new.md"), "brand new");
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    expect(fsSync.existsSync(path.join(agentDir, "skills", "new.md"))).toBe(
      false,
    );
    expect(read(path.join(agentDir, "CLAUDE.md"))).toBe("PROFILE A");
  });

  it("keeps changes and leaves no staging residue when the operation succeeds", async () => {
    await write(path.join(agentDir, "CLAUDE.md"), "PROFILE A");

    const result = await withActivationTransaction({
      installDir,
      agents: [agent],
      operation: async () => {
        await write(path.join(agentDir, "CLAUDE.md"), "PROFILE B");
        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(read(path.join(agentDir, "CLAUDE.md"))).toBe("PROFILE B");
    expect(fsSync.existsSync(path.join(tempHome, ".nori", ".txn"))).toBe(false);
  });

  it("restores the global active-skillset pointer when the operation throws", async () => {
    await updateConfig({ activeSkillset: "personal/profile-a" });

    await expect(
      withActivationTransaction({
        installDir,
        agents: [agent],
        operation: async () => {
          await updateConfig({ activeSkillset: "personal/profile-b" });
          throw new Error("nope");
        },
      }),
    ).rejects.toThrow("nope");

    const config = JSON.parse(
      read(path.join(tempHome, ".nori-config.json")) ?? "{}",
    );
    expect(config.activeSkillset).toBe("personal/profile-a");
  });

  it("restores an external settings file when the operation throws", async () => {
    const settingsPath = path.join(tempHome, ".claude", "settings.json");
    await write(settingsPath, '{"statusLine":"A"}');
    const agentWithSettings = createTestAgent({
      loaders: [
        { name: "instr", description: "d", run: async () => undefined },
      ],
      externalSettingsFiles: [settingsPath],
    });

    await expect(
      withActivationTransaction({
        installDir,
        agents: [agentWithSettings],
        operation: async () => {
          await write(settingsPath, '{"statusLine":"B"}');
          throw new Error("settings agent failed");
        },
      }),
    ).rejects.toThrow("settings agent failed");

    expect(read(settingsPath)).toBe('{"statusLine":"A"}');
  });
});

describe("recoverPendingActivations", () => {
  const seedLeftover = async (args: {
    id: string;
    targetPath: string;
    backupContent: string | null;
    committed: boolean;
  }): Promise<void> => {
    const { id, targetPath, backupContent, committed } = args;
    const txnDir = path.join(tempHome, ".nori", ".txn", id);
    await fs.mkdir(txnDir, { recursive: true });
    let backupPath: string | null = null;
    if (backupContent != null) {
      backupPath = path.join(txnDir, "0");
      await fs.writeFile(backupPath, backupContent);
    }
    await fs.writeFile(
      path.join(txnDir, "index.json"),
      JSON.stringify({ entries: [{ targetPath, backupPath }] }),
    );
    if (committed) await fs.writeFile(path.join(txnDir, "committed"), "");
  };

  it("restores an uncommitted leftover and clears the staging dir", async () => {
    const target = path.join(agentDir, "CLAUDE.md");
    await write(target, "PROFILE B (broken)");
    await seedLeftover({
      id: "crashed",
      targetPath: target,
      backupContent: "PROFILE A",
      committed: false,
    });

    await recoverPendingActivations();

    expect(read(target)).toBe("PROFILE A");
    expect(fsSync.existsSync(path.join(tempHome, ".nori", ".txn"))).toBe(false);
  });

  it("leaves a committed leftover in place and only clears the staging dir", async () => {
    const target = path.join(agentDir, "CLAUDE.md");
    await write(target, "PROFILE B (committed)");
    await seedLeftover({
      id: "committed-run",
      targetPath: target,
      backupContent: "PROFILE A",
      committed: true,
    });

    await recoverPendingActivations();

    expect(read(target)).toBe("PROFILE B (committed)");
    expect(fsSync.existsSync(path.join(tempHome, ".nori", ".txn"))).toBe(false);
  });

  it("is a no-op when there is no staging dir", async () => {
    await expect(recoverPendingActivations()).resolves.toBeUndefined();
  });
});
