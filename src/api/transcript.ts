/**
 * API client for transcript upload
 *
 * Uploads session transcripts to the user's private registry.
 */

import { apiRequest } from "@/api/base.js";

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
    const { sessionId, messages, title } = args;

    const body: Record<string, unknown> = {
      sessionId,
      messages,
    };

    if (title != null) {
      body.title = title;
    }

    return apiRequest<UploadTranscriptResponse>({
      path: "/transcripts",
      method: "POST",
      body,
    });
  },
};
