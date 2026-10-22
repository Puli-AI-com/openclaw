import { describe, expect, it } from "vitest";
import {
  classifyFailoverReason,
  extractRetryAfterMs,
  isSameModelRetryableError,
} from "./pi-embedded-helpers.js";

// Raw Bedrock InternalServerException from client.send() (PUL-274), no pi-ai prefix.
const BEDROCK_UNEXPECTED_ERROR =
  "The system encountered an unexpected error during processing. Try your request again. " +
  "Deserialization error: to see the raw response, inspect the hidden field {error}.$response on this object.";

describe("isSameModelRetryableError", () => {
  it.each([
    [BEDROCK_UNEXPECTED_ERROR, "timeout"],
    ["Internal server error: The system encountered an unexpected error", "timeout"],
    ["Model stream error: An error occurred while processing the response", "timeout"],
    ["Service unavailable: Bedrock is unavailable", "timeout"],
    ["InternalServerException: something broke", "timeout"],
    ["ModelStreamErrorException: stream closed", "timeout"],
    ["ServiceUnavailableException", "timeout"],
    ["ModelTimeoutException: model took too long", "timeout"],
    ["ModelNotReadyException: model is not ready", "timeout"],
    ["Bedrock is unable to process your request.", "timeout"],
    [
      'litellm.ServiceUnavailableError: BedrockException - {"message":"Bedrock is unable to process your request."}. Received Model Group=claude-haiku-4-5',
      "timeout",
    ],
    [
      "The pending stream has been canceled (caused by: getaddrinfo ENOTFOUND bedrock-runtime.eu-west-1.amazonaws.com)",
      "timeout",
    ],
    [
      "The system encountered an unexpected error during processing. Try your request again.\n  Deserialization error: to see the raw response, inspect the hidden field {error}.$response on this object.",
      "timeout",
    ],
    ["Throttling error: Too many tokens, please wait before trying again.", "rate_limit"],
    ["ThrottlingException: Rate exceeded", "rate_limit"],
  ])("retries %s", (message, reason) => {
    expect(classifyFailoverReason(message)).toBe(reason);
    expect(isSameModelRetryableError(message)).toBe(true);
  });

  it.each([
    "Validation error: Input is too long for requested model.",
    "Validation error: too many tokens in the request",
    "ValidationException: Malformed input request",
    "Validation error: Internal server error while validating",
    "AccessDeniedException: You don't have access to the model",
    "ResourceNotFoundException: Model not found",
    "ModelErrorException: The model returned an error",
    "Deserialization error: to see the raw response, inspect the hidden field",
    "Could not load credentials from any providers",
    'litellm.BadRequestError: BedrockException - {"message":"The provided model identifier is invalid."}. Received Model Group=claude-haiku-4-5',
    'litellm.BadRequestError: BedrockException - {"message":"The model returned the following errors: `temperature` may only be set to 1 when thinking is enabled."}',
    "Authentication Error, Invalid proxy server token passed. key=<redacted>, not found in db.",
    "401 Unauthorized",
    "403 Forbidden",
    "413 Request Entity Too Large",
    "429 You have reached your monthly spending limit",
    "429 You exceeded your current quota",
    "",
  ])("does not retry %s", (message) => {
    expect(isSameModelRetryableError(message)).toBe(false);
  });
});

describe("extractRetryAfterMs", () => {
  it("reads seconds and milliseconds", () => {
    expect(extractRetryAfterMs("429 Too Many Requests, retry after 7 seconds")).toBe(7000);
    expect(extractRetryAfterMs('{"retry_after": 1.5}')).toBe(1500);
    expect(extractRetryAfterMs("Retry-After: 250ms")).toBe(250);
    expect(extractRetryAfterMs("Throttling error: slow down")).toBeUndefined();
  });
});
