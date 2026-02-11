/**
 * Tests for login flow module
 *
 * These tests verify the loginFlow function behavior including:
 * - Successful login with credential collection and result display
 * - Cancellation handling
 * - Authentication error handling
 * - Output structure verification (E2E tests)
 */

import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginFlow, type LoginFlowCallbacks } from "./login.js";

// Mock @clack/prompts - we mock the interactive prompts but let UI functions run
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  group: vi.fn(),
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

describe("loginFlow", () => {
  const mockCallbacks: LoginFlowCallbacks = {
    onAuthenticate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  describe("successful login", () => {
    it("should call intro with login title", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret123",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev"],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.intro).toHaveBeenCalledWith("Log in to Nori Skillsets");
    });

    it("should skip intro when skipIntro is true", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret123",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks, skipIntro: true });

      expect(clack.intro).not.toHaveBeenCalled();
    });

    it("should use group to collect email and password together", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret123",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.group).toHaveBeenCalledTimes(1);
      // Verify group was called with email and password prompt factories
      const groupCall = vi.mocked(clack.group).mock.calls[0];
      expect(groupCall[0]).toHaveProperty("email");
      expect(groupCall[0]).toHaveProperty("password");
    });

    it("should call onAuthenticate with collected credentials", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "user@example.com",
        password: "mypassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "user@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(mockCallbacks.onAuthenticate).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "mypassword",
      });
    });

    it("should show spinner during authentication", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as any);
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(spinnerMock.start).toHaveBeenCalledWith("Authenticating...");
      expect(spinnerMock.stop).toHaveBeenCalledWith("Authenticated");
    });

    it("should show note with organizations when user has orgs", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev", "demo", "public"],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Organizations: dev, demo, public"),
        expect.any(String),
      );
    });

    it("should show Admin: Yes in note when user is admin", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev"],
        isAdmin: true,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        expect.stringContaining("Admin: Yes"),
        expect.any(String),
      );
    });

    it("should not show note when user has no organizations", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).not.toHaveBeenCalled();
    });

    it("should call outro with logged in message", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: [],
        isAdmin: false,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.outro).toHaveBeenCalledWith("Logged in as test@example.com");
    });

    it("should return credentials on successful login", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "secret123",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: true,
        userEmail: "test@example.com",
        organizations: ["dev"],
        isAdmin: true,
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
      });

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toEqual({
        email: "test@example.com",
        refreshToken: "mock-refresh-token",
        idToken: "mock-id-token",
        organizations: ["dev"],
        isAdmin: true,
      });
    });
  });

  describe("authentication failure", () => {
    it("should stop spinner with failure message on auth error", async () => {
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.spinner).mockReturnValue(spinnerMock as any);
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "wrongpassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(spinnerMock.stop).toHaveBeenCalledWith("Authentication failed");
    });

    it("should show error message using log.error", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "wrongpassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.log.error).toHaveBeenCalledWith("Invalid credentials");
    });

    it("should show note with hint when error hint is provided", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "wrongpassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
        hint: "Check that your email and password are correct.",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.note).toHaveBeenCalledWith(
        "Check that your email and password are correct.",
        "Hint",
      );
    });

    it("should not call outro on auth failure", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "wrongpassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.outro).not.toHaveBeenCalled();
    });

    it("should return null on auth failure", async () => {
      vi.mocked(clack.group).mockResolvedValueOnce({
        email: "test@example.com",
        password: "wrongpassword",
      });
      vi.mocked(mockCallbacks.onAuthenticate).mockResolvedValueOnce({
        success: false,
        error: "Invalid credentials",
      });

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });
  });

  describe("cancellation", () => {
    it("should return null when user cancels during prompts", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.group).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      const result = await loginFlow({ callbacks: mockCallbacks });

      expect(result).toBeNull();
    });

    it("should call cancel with message when user cancels", async () => {
      const cancelSymbol = Symbol.for("cancel");
      // The cancel is called via the onCancel handler in group options
      // We need to capture and invoke the onCancel callback
      vi.mocked(clack.group).mockImplementationOnce(
        async (_prompts, options) => {
          // Simulate cancellation by calling onCancel and returning cancel symbol
          options?.onCancel?.({ results: {} });
          return cancelSymbol as any;
        },
      );
      vi.mocked(clack.isCancel).mockReturnValue(true);

      await loginFlow({ callbacks: mockCallbacks });

      expect(clack.cancel).toHaveBeenCalledWith("Login cancelled.");
    });

    it("should not call onAuthenticate when user cancels", async () => {
      const cancelSymbol = Symbol.for("cancel");
      vi.mocked(clack.group).mockResolvedValueOnce(cancelSymbol as any);
      vi.mocked(clack.isCancel).mockReturnValue(true);

      await loginFlow({ callbacks: mockCallbacks });

      expect(mockCallbacks.onAuthenticate).not.toHaveBeenCalled();
    });
  });
});

describe("loginFlow E2E output structure", () => {
  // These tests verify the actual UI output structure
  // They use real @clack/prompts functions with custom output streams

  it.todo("outputs intro, spinner, note, outro in correct order");
  it.todo("outputs organization info in note box format");
});
