/**
 * Tests for the `seed` CLI command orchestration.
 *
 * The seed command replaces N sequential subprocess invocations
 * (download + fork + upload per skillset) with a single in-process run that
 * seeds a whole manifest. These tests exercise the orchestration only: the
 * download / fork / upload primitives are mocked at the module boundary so the
 * unit under test is the seed loop, dedupe, failure isolation, and the
 * machine-readable result sentinel.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the three primitives seed orchestrates. Seed must reuse these verbatim.
vi.mock("@/cli/commands/registry-download/registryDownload.js", () => ({
  registryDownloadMain: vi.fn(),
}));
vi.mock("@/cli/commands/fork-skillset/forkSkillset.js", () => ({
  forkSkillsetMain: vi.fn(),
}));
vi.mock("@/cli/commands/registry-upload/registryUpload.js", () => ({
  registryUploadMain: vi.fn(),
}));

import { forkSkillsetMain } from "@/cli/commands/fork-skillset/forkSkillset.js";
import { registryDownloadMain } from "@/cli/commands/registry-download/registryDownload.js";
import { registryUploadMain } from "@/cli/commands/registry-upload/registryUpload.js";
import { bold } from "@/cli/logger.js";

import { seedMain } from "./seed.js";

type SeedResult = {
  succeeded: Array<{ source: string; target: string; version: string | null }>;
  failed: Array<{
    source: string;
    target: string;
    phase: "download" | "rescope" | "upload";
    dependency: string | null;
    error: string;
  }>;
  timings: {
    total_ms: number;
    phases: Array<{ target: string; download_ms: number; upload_ms: number }>;
  };
};

const SENTINEL_PREFIX = "NORI_SEED_RESULT_JSON=";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

const getSentinelLines = (): Array<string> => {
  return consoleLogSpy.mock.calls
    .map((call) => String(call[0] ?? ""))
    .filter((line) => line.startsWith(SENTINEL_PREFIX));
};

const getSentinel = (): SeedResult => {
  const lines = getSentinelLines();
  if (lines.length !== 1) {
    throw new Error(
      `expected exactly one sentinel line, found ${lines.length}`,
    );
  }
  const json = lines[0].slice(SENTINEL_PREFIX.length);
  return JSON.parse(json) as SeedResult;
};

const uploadedMessage = (spec: string, version: string): string =>
  `Uploaded ${bold({ text: `${spec}@${version}` })}`;

beforeEach(() => {
  vi.clearAllMocks();
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  vi.mocked(registryDownloadMain).mockResolvedValue({
    success: true,
    cancelled: false,
    message: "downloaded",
  });
  vi.mocked(forkSkillsetMain).mockResolvedValue({
    success: true,
    cancelled: false,
    message: "forked",
  });
  vi.mocked(registryUploadMain).mockImplementation(
    async (args: { profileSpec: string }) => ({
      success: true,
      cancelled: false,
      message: uploadedMessage(args.profileSpec, "1.0.0"),
    }),
  );
});

describe("seedMain", () => {
  it("downloads each source and uploads each target for a multi-entry manifest", async () => {
    const result = await seedMain({
      orgId: "acme",
      manifest: [
        { source: "sessions-template", name: "sessions" },
        { source: "docs-template", name: "docs" },
        { source: "review-template", name: "review" },
      ],
    });

    expect(result.success).toBe(true);

    expect(registryDownloadMain).toHaveBeenCalledTimes(3);
    expect(forkSkillsetMain).toHaveBeenCalledTimes(3);
    expect(registryUploadMain).toHaveBeenCalledTimes(3);

    const sentinel = getSentinel();
    expect(sentinel.failed).toEqual([]);
    expect(sentinel.succeeded.map((s) => s.target)).toEqual([
      "acme/sessions",
      "acme/docs",
      "acme/review",
    ]);
    for (const entry of sentinel.succeeded) {
      expect(entry.version).toBe("1.0.0");
    }
  });

  it("downloads a shared source only once but forks and uploads each target", async () => {
    await seedMain({
      orgId: "acme",
      manifest: [
        { source: "shared-template", name: "alpha" },
        { source: "shared-template", name: "beta" },
      ],
    });

    const downloadedSpecs = vi
      .mocked(registryDownloadMain)
      .mock.calls.map((call) => call[0].packageSpec);
    expect(downloadedSpecs).toEqual(["shared-template"]);

    expect(forkSkillsetMain).toHaveBeenCalledTimes(2);
    expect(registryUploadMain).toHaveBeenCalledTimes(2);

    const sentinel = getSentinel();
    expect(sentinel.succeeded.map((s) => s.target)).toEqual([
      "acme/alpha",
      "acme/beta",
    ]);
  });

  it("uploads with conflict resolution (updateVersion, non-interactive) and never silent", async () => {
    await seedMain({
      orgId: "acme",
      manifest: [{ source: "sessions-template", name: "sessions" }],
    });

    expect(registryUploadMain).toHaveBeenCalledTimes(1);
    const uploadArg = vi.mocked(registryUploadMain).mock.calls[0][0];

    expect(uploadArg.nonInteractive).toBe(true);
    expect(uploadArg.resolve).toBe("updateVersion");
    // The silent path skips --resolve conflict resolution, so seed MUST NOT set it.
    expect(uploadArg.silent === true).toBe(false);
  });

  it("routes uploads by scope with no explicit registry URL", async () => {
    await seedMain({
      orgId: "acme",
      manifest: [{ source: "sessions-template", name: "sessions" }],
    });

    const uploadArg = vi.mocked(registryUploadMain).mock.calls[0][0];
    // Scope-derived routing: the org-scoped profileSpec drives org registry
    // selection; seed must not pass an explicit registry URL.
    expect(uploadArg.profileSpec).toBe("acme/sessions");
    expect(uploadArg.registryUrl == null).toBe(true);
  });

  it("emits only contract fields, carrying no auth material into the result", async () => {
    // Seed handles no credentials itself (the idToken lives only in the config
    // file read by the upload primitive, never passed to or seen by seed). The
    // guarantee we can assert here is structural: the emitted result contains
    // exactly the contract fields and nothing rides along that could carry a
    // credential a future bug might introduce. Drive both a success and a
    // failure so both entry shapes are checked.
    vi.mocked(registryUploadMain).mockImplementation(
      async (args: { profileSpec: string }) => {
        if (args.profileSpec === "acme/beta") {
          return { success: false, cancelled: false, message: "upload boom" };
        }
        return {
          success: true,
          cancelled: false,
          message: uploadedMessage(args.profileSpec, "1.0.0"),
        };
      },
    );

    await seedMain({
      orgId: "acme",
      manifest: [
        { source: "sessions-template", name: "alpha" },
        { source: "docs-template", name: "beta" },
      ],
    });

    const sentinel = getSentinel();
    expect(Object.keys(sentinel).sort()).toEqual([
      "failed",
      "succeeded",
      "timings",
    ]);
    for (const entry of sentinel.succeeded) {
      expect(Object.keys(entry).sort()).toEqual([
        "source",
        "target",
        "version",
      ]);
    }
    for (const entry of sentinel.failed) {
      expect(Object.keys(entry).sort()).toEqual([
        "dependency",
        "error",
        "phase",
        "source",
        "target",
      ]);
    }
  });

  it("isolates per-entry failures across download and upload phases without aborting the batch", async () => {
    vi.mocked(registryDownloadMain).mockImplementation(
      async (args: { packageSpec: string }) => {
        if (args.packageSpec === "bad-download") {
          return { success: false, cancelled: false, message: "download boom" };
        }
        return { success: true, cancelled: false, message: "downloaded" };
      },
    );
    vi.mocked(registryUploadMain).mockImplementation(
      async (args: { profileSpec: string }) => {
        if (args.profileSpec === "acme/gamma") {
          return { success: false, cancelled: false, message: "upload boom" };
        }
        return {
          success: true,
          cancelled: false,
          message: uploadedMessage(args.profileSpec, "1.0.0"),
        };
      },
    );

    const result = await seedMain({
      orgId: "acme",
      manifest: [
        { source: "good-template", name: "alpha" },
        { source: "bad-download", name: "beta" },
        { source: "good-template", name: "gamma" },
      ],
    });

    // The command ran to completion and emitted a result.
    expect(result.success).toBe(true);
    const sentinel = getSentinel();

    expect(sentinel.succeeded.map((s) => s.target)).toEqual(["acme/alpha"]);

    const failedByTarget = Object.fromEntries(
      sentinel.failed.map((f) => [f.target, f]),
    );
    expect(failedByTarget["acme/beta"].phase).toBe("download");
    expect(failedByTarget["acme/beta"].source).toBe("bad-download");
    expect(failedByTarget["acme/beta"].error).toContain("download boom");

    expect(failedByTarget["acme/gamma"].phase).toBe("upload");
    expect(failedByTarget["acme/gamma"].error).toContain("upload boom");
  });

  it("reports whatever version the upload primitive returns on each run", async () => {
    // Idempotency / no-churn is a server-side guarantee (content-hash dedup) and
    // is exercised by the registrar's e2e test, not here — the primitives are
    // mocked. What seed owns is faithfully reporting the version the upload
    // primitive returns, run over run, including when it changes.
    const runOnce = async (version: string): Promise<SeedResult> => {
      vi.clearAllMocks();
      consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      vi.mocked(registryDownloadMain).mockResolvedValue({
        success: true,
        cancelled: false,
        message: "downloaded",
      });
      vi.mocked(forkSkillsetMain).mockResolvedValue({
        success: true,
        cancelled: false,
        message: "forked",
      });
      vi.mocked(registryUploadMain).mockResolvedValue({
        success: true,
        cancelled: false,
        message: uploadedMessage("acme/sessions", version),
      });
      await seedMain({
        orgId: "acme",
        manifest: [{ source: "sessions-template", name: "sessions" }],
      });
      return getSentinel();
    };

    const first = await runOnce("1.0.0");
    expect(first.succeeded[0].version).toBe("1.0.0");

    // Re-run reporting the same version: one upload attempt, same version out.
    const unchanged = await runOnce("1.0.0");
    expect(unchanged.succeeded[0].version).toBe("1.0.0");
    expect(registryUploadMain).toHaveBeenCalledTimes(1);

    // Changed content: the new version is reported.
    const changed = await runOnce("1.1.0");
    expect(changed.succeeded[0].version).toBe("1.1.0");
  });

  it("emits exactly one sentinel line matching the result contract shape", async () => {
    await seedMain({
      orgId: "acme",
      manifest: [
        { source: "sessions-template", name: "sessions" },
        { source: "docs-template", name: "docs" },
      ],
    });

    expect(getSentinelLines()).toHaveLength(1);
    const sentinel = getSentinel();

    expect(Array.isArray(sentinel.succeeded)).toBe(true);
    expect(Array.isArray(sentinel.failed)).toBe(true);
    expect(typeof sentinel.timings.total_ms).toBe("number");
    expect(Array.isArray(sentinel.timings.phases)).toBe(true);

    expect(sentinel.timings.phases.map((p) => p.target)).toEqual([
      "acme/sessions",
      "acme/docs",
    ]);
    for (const phase of sentinel.timings.phases) {
      expect(typeof phase.download_ms).toBe("number");
      expect(typeof phase.upload_ms).toBe("number");
    }

    for (const entry of sentinel.succeeded) {
      expect(typeof entry.source).toBe("string");
      expect(typeof entry.target).toBe("string");
      expect(entry.version === null || typeof entry.version === "string").toBe(
        true,
      );
    }
  });
});
