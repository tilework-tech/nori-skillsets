/**
 * Tests for commit-author PreToolUse hook
 */

import { describe, it, expect } from "vitest";

import { isGitCommitCommand, replaceAttribution } from "./commit-author.js";

describe("commit-author hook", () => {
  describe("isGitCommitCommand", () => {
    it("should return false for non-git commands", () => {
      expect(isGitCommitCommand({ command: "ls -la" })).toBe(false);
    });

    it("should return false for git commands without commit", () => {
      expect(isGitCommitCommand({ command: "git status" })).toBe(false);
      expect(isGitCommitCommand({ command: "git push" })).toBe(false);
      expect(isGitCommitCommand({ command: "git pull" })).toBe(false);
    });

    it("should return false for git commit without -m flag", () => {
      expect(isGitCommitCommand({ command: "git commit" })).toBe(false);
    });

    it("should return true for git commit with -m flag", () => {
      expect(isGitCommitCommand({ command: 'git commit -m "fix: bug"' })).toBe(
        true,
      );
    });

    it("should return true for git commit with --message flag", () => {
      expect(
        isGitCommitCommand({ command: 'git commit --message "fix: bug"' }),
      ).toBe(true);
    });

    it("should return true for git commit with -C flag before commit", () => {
      expect(
        isGitCommitCommand({
          command:
            'git -C /home/user/project/.worktrees/feature-branch commit -m "test"',
        }),
      ).toBe(true);
    });

    it("should return true for git commit with additional flags", () => {
      expect(
        isGitCommitCommand({ command: 'git commit -a -s -m "fix: bug"' }),
      ).toBe(true);
    });
  });

  describe("replaceAttribution", () => {
    it("should replace Claude attribution with Nori attribution", () => {
      const input = `git commit -m "$(cat <<'EOF'
feat: Add new feature

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"`;

      const result = replaceAttribution({ command: input });

      expect(result).toContain("Co-Authored-By: Nori <contact@tilework.tech>");
      expect(result).not.toContain("Co-Authored-By: Claude");
    });

    it("should replace Claude Code URL with Nori URL", () => {
      const input = `git commit -m "$(cat <<'EOF'
feat: Add feature

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"`;

      const result = replaceAttribution({ command: input });

      expect(result).toContain(
        "🤖 Generated with [Nori](https://noriagentic.com)",
      );
      expect(result).not.toContain("Claude Code");
    });

    it("should add Nori attribution to simple commit message with double quotes", () => {
      const result = replaceAttribution({
        command: 'git commit -m "fix: bug"',
      });

      expect(result).toContain("fix: bug");
      expect(result).toContain("Co-Authored-By: Nori <contact@tilework.tech>");
      expect(result).toContain(
        "🤖 Generated with [Nori](https://noriagentic.com)",
      );
    });

    it("should add Nori attribution to simple commit message with single quotes", () => {
      const result = replaceAttribution({
        command: "git commit -m 'fix: bug'",
      });

      expect(result).toContain("fix: bug");
      expect(result).toContain("Co-Authored-By: Nori <contact@tilework.tech>");
    });

    it("should add Nori attribution to heredoc format without existing attribution", () => {
      const input = `git commit -m "$(cat <<'EOF'
feat: Add new feature

This is a longer commit message.
EOF
)"`;

      const result = replaceAttribution({ command: input });

      expect(result).toContain("feat: Add new feature");
      expect(result).toContain("This is a longer commit message");
      expect(result).toContain("Co-Authored-By: Nori <contact@tilework.tech>");
      expect(result).toContain(
        "🤖 Generated with [Nori](https://noriagentic.com)",
      );
    });

    it("should preserve original commit message structure", () => {
      const result = replaceAttribution({
        command: 'git commit -m "fix: resolve authentication bug"',
      });

      // Original message should be preserved and come before attribution
      expect(result).toContain("fix: resolve authentication bug");
      const messageIndex = result.indexOf("fix: resolve authentication bug");
      const attributionIndex = result.indexOf("Co-Authored-By: Nori");

      expect(messageIndex).toBeLessThan(attributionIndex);
    });

    it("should preserve additional git flags", () => {
      const result = replaceAttribution({
        command: 'git commit -a -s -m "fix: bug"',
      });

      expect(result).toContain("-a");
      expect(result).toContain("-s");
      expect(result).toContain("-m");
    });

    it("should handle git commit with -C flag", () => {
      const input = `git -C /home/user/project/.worktrees/feature-branch commit -m "$(cat <<'EOF'
Add new feature

This commit adds a new feature to the project.
EOF
)"`;

      const result = replaceAttribution({ command: input });

      expect(result).toContain("Add new feature");
      expect(result).toContain("Co-Authored-By: Nori <contact@tilework.tech>");
    });

    it("should use real newlines (not literal \\n) between message and attribution in -m form", () => {
      const result = replaceAttribution({
        command: 'git commit -m "fix: bug"',
      });

      // Bash sees the command as-is; for newlines to land in the commit message,
      // the appended attribution must use real \n characters, not the two-char
      // sequence backslash-n.
      expect(result).toContain("fix: bug\n\n🤖 Generated with [Nori]");
      expect(result).toContain(
        "\n\nCo-Authored-By: Nori <contact@tilework.tech>",
      );
    });

    it("should not double-append attribution in EOF heredoc when Nori attribution already present", () => {
      const command = `git commit -m "$(cat <<'EOF'
feat: Add new feature

🤖 Generated with [Nori](https://noriagentic.com)

Co-Authored-By: Nori <contact@tilework.tech>
EOF
)"`;

      const result = replaceAttribution({ command });

      const noriCoAuthorCount = (
        result.match(/Co-Authored-By: Nori <contact@tilework\.tech>/g) ?? []
      ).length;
      const noriUrlCount = (
        result.match(
          /🤖 Generated with \[Nori\]\(https:\/\/noriagentic\.com\)/g,
        ) ?? []
      ).length;

      expect(noriCoAuthorCount).toBe(1);
      expect(noriUrlCount).toBe(1);
    });
  });
});
