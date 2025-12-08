import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { promptUser } from "@/cli/prompt.js";

import type { RegistryAuth } from "@/cli/config.js";

import { promptRegistryAuths } from "./registryAuthPrompt.js";

// Mock the prompt module
vi.mock("@/cli/prompt.js", () => ({
  promptUser: vi.fn(),
}));

const mockedPromptUser = vi.mocked(promptUser);

describe("promptRegistryAuths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return null when user declines to add registry auth", async () => {
    // User answers "n" to initial prompt
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toBeNull();
    expect(mockedPromptUser).toHaveBeenCalledTimes(1);
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("registry authentication"),
    });
  });

  it("should return null when user presses enter (empty response)", async () => {
    // User presses enter without typing anything
    mockedPromptUser.mockResolvedValueOnce("");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toBeNull();
  });

  it("should collect single registry auth when user adds one", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Registry URL
    mockedPromptUser.mockResolvedValueOnce("https://registry.example.com");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password (hidden)
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://registry.example.com",
        username: "user@example.com",
        password: "secret123",
      },
    ]);

    // Verify password was requested with hidden: true
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Password"),
      hidden: true,
    });
  });

  it("should collect multiple registry auths when user adds more than one", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // First registry
    mockedPromptUser.mockResolvedValueOnce("https://registry1.example.com");
    mockedPromptUser.mockResolvedValueOnce("user1@example.com");
    mockedPromptUser.mockResolvedValueOnce("password1");
    // User answers "y" to add another
    mockedPromptUser.mockResolvedValueOnce("y");
    // Second registry
    mockedPromptUser.mockResolvedValueOnce("https://registry2.example.com");
    mockedPromptUser.mockResolvedValueOnce("user2@example.com");
    mockedPromptUser.mockResolvedValueOnce("password2");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://registry1.example.com",
        username: "user1@example.com",
        password: "password1",
      },
      {
        registryUrl: "https://registry2.example.com",
        username: "user2@example.com",
        password: "password2",
      },
    ]);
  });

  it("should show existing registry auths and allow keeping them", async () => {
    const existingAuths: Array<RegistryAuth> = [
      {
        registryUrl: "https://existing.example.com",
        username: "existing@example.com",
        password: "existingpass",
      },
    ];

    // User answers "y" to keep existing
    mockedPromptUser.mockResolvedValueOnce("y");

    const result = await promptRegistryAuths({
      existingRegistryAuths: existingAuths,
    });

    expect(result).toEqual(existingAuths);
    expect(mockedPromptUser).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Keep existing"),
    });
  });

  it("should allow reconfiguring when user declines to keep existing", async () => {
    const existingAuths: Array<RegistryAuth> = [
      {
        registryUrl: "https://existing.example.com",
        username: "existing@example.com",
        password: "existingpass",
      },
    ];

    // User answers "n" to keep existing
    mockedPromptUser.mockResolvedValueOnce("n");
    // User answers "y" to add new registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // New registry
    mockedPromptUser.mockResolvedValueOnce("https://new.example.com");
    mockedPromptUser.mockResolvedValueOnce("new@example.com");
    mockedPromptUser.mockResolvedValueOnce("newpass");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({
      existingRegistryAuths: existingAuths,
    });

    expect(result).toEqual([
      {
        registryUrl: "https://new.example.com",
        username: "new@example.com",
        password: "newpass",
      },
    ]);
  });

  it("should re-prompt for invalid URL format", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // Invalid URL first
    mockedPromptUser.mockResolvedValueOnce("not-a-valid-url");
    // Valid URL second attempt
    mockedPromptUser.mockResolvedValueOnce("https://registry.example.com");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://registry.example.com",
        username: "user@example.com",
        password: "secret123",
      },
    ]);

    // Should have prompted for URL twice (once invalid, once valid)
    const urlPromptCalls = mockedPromptUser.mock.calls.filter((call) =>
      call[0].prompt.toLowerCase().includes("registry url"),
    );
    expect(urlPromptCalls.length).toBe(2);
  });

  it("should normalize registry URL by removing trailing slash", async () => {
    // User answers "y" to add registry
    mockedPromptUser.mockResolvedValueOnce("y");
    // URL with trailing slash
    mockedPromptUser.mockResolvedValueOnce("https://registry.example.com/");
    // Username
    mockedPromptUser.mockResolvedValueOnce("user@example.com");
    // Password
    mockedPromptUser.mockResolvedValueOnce("secret123");
    // User answers "n" to add another
    mockedPromptUser.mockResolvedValueOnce("n");

    const result = await promptRegistryAuths({ existingRegistryAuths: null });

    expect(result).toEqual([
      {
        registryUrl: "https://registry.example.com",
        username: "user@example.com",
        password: "secret123",
      },
    ]);
  });
});
