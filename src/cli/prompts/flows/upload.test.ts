/**
 * Tests for upload flow
 *
 * Tests the interactive upload flow including batch conflict resolution,
 * use existing option, and one-by-one resolution.
 */
import * as clack from "@clack/prompts";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { UploadFlowCallbacks, UploadResult } from "./upload.js";
import type { SkillConflict } from "@/api/registrar.js";

import { uploadFlow } from "./upload.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  note: vi.fn(),
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

// Cancel symbol used by clack
const cancelSymbol = Symbol.for("cancel");

/**
 * Helper to create a mock callbacks object for uploadFlow
 * @param args - The function arguments
 * @param args.version - Version to return from onDetermineVersion
 * @param args.uploadResults - Sequence of upload results to return
 *
 * @returns Mock callbacks for uploadFlow
 */
const createMockCallbacks = (args: {
  version?: string | null;
  uploadResults: Array<UploadResult>;
}): UploadFlowCallbacks => {
  const { version, uploadResults } = args;
  const onUpload = vi.fn();
  for (const result of uploadResults) {
    onUpload.mockResolvedValueOnce(result);
  }
  return {
    onDetermineVersion: vi.fn().mockResolvedValue({
      version: version ?? "1.0.0",
      isNewPackage: false,
    }),
    onUpload,
  };
};

/**
 * Helper to get text content passed to clack.note
 *
 * @returns Array of note content strings
 */
const getNoteContent = (): Array<string> => {
  return vi
    .mocked(clack.note)
    .mock.calls.map((call) => `${call[0] ?? ""} ${call[1] ?? ""}`);
};

describe("uploadFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("use existing option", () => {
    it("should show use existing option for changed skills", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "changed-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          owner: "me@example.com",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      // User selects "link" (which is the "Use Existing" option for changed skills)
      vi.mocked(clack.select).mockResolvedValueOnce("link");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Verify the select prompt included a "Use Existing" labeled option
      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      const options = selectCall.options as Array<{
        value: string;
        label: string;
        hint?: string;
      }>;
      const useExistingOption = options.find((o) => o.value === "link");
      expect(useExistingOption).toBeDefined();
      expect(useExistingOption?.label).toBe("Use Existing");
      expect(useExistingOption?.hint).toContain("discard any local changes");
    });

    it("should NOT show use existing option for unchanged skills", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "unchanged-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          owner: "other@example.com",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true,
        },
      ];

      // This conflict is auto-resolved, so no select prompt should appear
      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Auto-resolved — no select prompt should have been called
      expect(clack.select).not.toHaveBeenCalled();
    });

    it("should show 'Use Existing' label for changed skills when link is available in one-by-one mode", async () => {
      // A changed skill that has link in availableActions (content changed, so "Use Existing" with discard warning)
      // + an unchanged skill without link in availableActions (so it goes to interactive with only namespace/updateVersion)
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "changed-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "unchanged-no-link",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion"],
          contentUnchanged: true,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      // Batch prompt: "Choose one-by-one"
      vi.mocked(clack.select)
        .mockResolvedValueOnce("one-by-one") // batch prompt
        .mockResolvedValueOnce("namespace") // first conflict
        .mockResolvedValueOnce("namespace"); // second conflict

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // The first conflict (changed) should have "Use Existing" for the link option
      const firstConflictCall = vi.mocked(clack.select).mock.calls[1][0];
      const firstOptions = firstConflictCall.options as Array<{
        value: string;
        label: string;
        hint?: string;
      }>;
      const useExistingOption = firstOptions.find((o) => o.value === "link");
      expect(useExistingOption).toBeDefined();
      expect(useExistingOption?.label).toBe("Use Existing");
      expect(useExistingOption?.hint).toContain("discard any local changes");
    });

    it("should track skipped skills in the result", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skipped-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: {
              succeeded: [{ name: "skipped-skill", version: "1.0.0" }],
              failed: [],
            },
          },
        ],
      });

      // User picks "link" (use existing)
      vi.mocked(clack.select).mockResolvedValueOnce("link");

      const result = await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      expect(result).not.toBeNull();
      expect(result!.skippedSkillIds.has("skipped-skill")).toBe(true);
    });

    it("should show skipped skills in the summary note", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skipped-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: {
              succeeded: [{ name: "skipped-skill", version: "1.0.0" }],
              failed: [],
            },
          },
        ],
      });

      vi.mocked(clack.select).mockResolvedValueOnce("link");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      const noteContent = getNoteContent().join("\n");
      expect(noteContent).toContain("Skipped");
      expect(noteContent).toContain("skipped-skill");
    });
  });

  describe("batch conflict resolution", () => {
    it("should show batch prompt when multiple unresolved conflicts exist", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      // Batch prompt: resolve all the same way -> namespace
      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same") // batch prompt
        .mockResolvedValueOnce("namespace"); // resolution action

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // First select should be the batch prompt
      const firstSelect = vi.mocked(clack.select).mock.calls[0][0];
      const firstOptions = firstSelect.options as Array<{
        value: string;
        label: string;
      }>;
      const optionValues = firstOptions.map((o) => o.value);
      expect(optionValues).toContain("all-same");
      expect(optionValues).toContain("one-by-one");
    });

    it("should NOT show batch prompt when only 1 unresolved conflict exists", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "single-skill",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      // Direct resolution (no batch prompt)
      vi.mocked(clack.select).mockResolvedValueOnce("namespace");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Only one select call (the conflict resolution itself)
      expect(clack.select).toHaveBeenCalledTimes(1);
      const selectCall = vi.mocked(clack.select).mock.calls[0][0];
      // Should be the conflict resolution, not the batch prompt
      expect(selectCall.message).toContain("single-skill");
    });

    it("should apply chosen action to all conflicts when 'resolve all same way' is selected with namespace", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("namespace");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Verify the upload retry used namespace for both
      const lastUploadCall = vi.mocked(callbacks.onUpload).mock.calls[1][0];
      expect(lastUploadCall.resolutionStrategy).toEqual(
        expect.objectContaining({
          "skill-a": { action: "namespace" },
          "skill-b": { action: "namespace" },
        }),
      );
    });

    it("should apply updateVersion to all with individual incremented versions when 'resolve all same way' is selected", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.3.4",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("updateVersion");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Verify each skill got its own incremented version
      const lastUploadCall = vi.mocked(callbacks.onUpload).mock.calls[1][0];
      expect(lastUploadCall.resolutionStrategy).toEqual(
        expect.objectContaining({
          "skill-a": { action: "updateVersion", version: "1.0.1" },
          "skill-b": { action: "updateVersion", version: "2.3.5" },
        }),
      );
    });

    it("should apply skip (link) to all when 'resolve all same way' is selected with skip", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("link"); // skip

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      const lastUploadCall = vi.mocked(callbacks.onUpload).mock.calls[1][0];
      expect(lastUploadCall.resolutionStrategy).toEqual(
        expect.objectContaining({
          "skill-a": { action: "link" },
          "skill-b": { action: "link" },
        }),
      );
    });

    it("should fall through to one-by-one resolution when 'choose one-by-one' is selected", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("one-by-one") // batch prompt
        .mockResolvedValueOnce("namespace") // skill-a
        .mockResolvedValueOnce("link"); // skill-b (skip)

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // 3 select calls: batch prompt + 2 individual conflicts
      expect(clack.select).toHaveBeenCalledTimes(3);

      const lastUploadCall = vi.mocked(callbacks.onUpload).mock.calls[1][0];
      expect(lastUploadCall.resolutionStrategy).toEqual(
        expect.objectContaining({
          "skill-a": { action: "namespace" },
          "skill-b": { action: "link" },
        }),
      );
    });

    it("should show note listing all conflicts before batch prompt", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("namespace");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Note should have been called with conflict details
      const noteContent = getNoteContent().join("\n");
      expect(noteContent).toContain("skill-a");
      expect(noteContent).toContain("skill-b");
    });

    it("should only show common actions in batch resolve-all-same-way prompt", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: false,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("namespace");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // The resolution action select (second call) should only have common actions
      const actionSelect = vi.mocked(clack.select).mock.calls[1][0];
      const actionOptions = actionSelect.options as Array<{
        value: string;
        label: string;
      }>;
      const actionValues = actionOptions.map((o) => o.value);

      // namespace and link (skip) are common, updateVersion is NOT (skill-b can't publish)
      expect(actionValues).toContain("namespace");
      expect(actionValues).toContain("link"); // use existing option
      expect(actionValues).not.toContain("updateVersion");
    });

    it("should handle cancellation during batch prompt", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [{ success: false, conflicts }],
      });

      // Simulate cancellation
      vi.mocked(clack.isCancel).mockReturnValueOnce(true);
      vi.mocked(clack.select).mockResolvedValueOnce(cancelSymbol);

      const result = await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      expect(result).toBeNull();
    });

    it("should handle mix of auto-resolvable and batch-resolvable conflicts", async () => {
      const conflicts: Array<SkillConflict> = [
        {
          skillId: "unchanged-skill",
          exists: true,
          canPublish: false,
          latestVersion: "1.0.0",
          availableActions: ["cancel", "namespace", "link"],
          contentUnchanged: true, // auto-resolves
        },
        {
          skillId: "changed-skill-a",
          exists: true,
          canPublish: true,
          latestVersion: "2.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
        {
          skillId: "changed-skill-b",
          exists: true,
          canPublish: true,
          latestVersion: "3.0.0",
          availableActions: ["cancel", "namespace", "updateVersion", "link"],
          contentUnchanged: false,
        },
      ];

      const callbacks = createMockCallbacks({
        uploadResults: [
          { success: false, conflicts },
          {
            success: true,
            version: "1.0.0",
            extractedSkills: { succeeded: [], failed: [] },
          },
        ],
      });

      // Batch prompt for the 2 unresolved -> resolve all same way -> namespace
      vi.mocked(clack.select)
        .mockResolvedValueOnce("all-same")
        .mockResolvedValueOnce("namespace");

      await uploadFlow({
        profileDisplayName: "myorg/my-profile",
        profileName: "my-profile",
        registryUrl: "https://myorg.noriskillsets.dev",
        callbacks,
      });

      // Verify combined strategy has auto-resolved + batch-resolved
      const lastUploadCall = vi.mocked(callbacks.onUpload).mock.calls[1][0];
      expect(lastUploadCall.resolutionStrategy).toEqual(
        expect.objectContaining({
          "unchanged-skill": { action: "link" },
          "changed-skill-a": { action: "namespace" },
          "changed-skill-b": { action: "namespace" },
        }),
      );
    });
  });
});
