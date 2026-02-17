/**
 * API client for transcript upload
 *
 * Uploads session transcripts to the user's private registry.
 */

import { apiRequest } from "@/api/base.js";
import { buildOrganizationRegistryUrl } from "@/utils/url.js";

/**
 * A message in a transcript (simplified type for upload)
 */
export type TranscriptMessage = {
  type?: string;
  sessionId?: string | null;
  message?: {
    role?: string;
    content?: string | Array<unknown>;
  };
  summary?: string;
  [key: string]: unknown;
};

/**
 * Request payload for uploading a transcript
 */
export type UploadTranscriptRequest = {
  sessionId: string;
  messages: Array<TranscriptMessage>;
  title?: string | null;
  /** Project name for associating the transcript with a project */
  projectName?: string | null;
  /** Organization ID to upload to (e.g., "myorg" -> https://myorg.noriskillsets.dev) */
  orgId?: string | null;
};

/**
 * Response from transcript upload
 */
export type UploadTranscriptResponse = {
  id: string;
  title: string;
  sessionId: string;
  createdAt: string;
};

export const transcriptApi = {
  /**
   * Upload a transcript to the registry
   *
   * @param args - Upload request parameters
   *
   * @returns Upload response with transcript metadata
   */
  upload: async (
    args: UploadTranscriptRequest,
  ): Promise<UploadTranscriptResponse> => {
    const { sessionId, messages, title, projectName, orgId } = args;

    const body: Record<string, unknown> = {
      sessionId,
      messages,
    };

    if (title != null) {
      body.title = title;
    }

    if (projectName != null) {
      body.projectName = projectName;
    }

    // Build org-specific base URL if orgId is provided
    const baseUrl =
      orgId != null ? buildOrganizationRegistryUrl({ orgId }) : undefined;

    return apiRequest<UploadTranscriptResponse>({
      path: "/transcripts",
      method: "POST",
      body,
      ...(baseUrl != null && { baseUrl }),
    });
  },
};
