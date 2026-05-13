---
name: goose-integration
description: Credential setup for Goose in Nori Sessions
---

# Goose Integration Setup

## What This Does

Configures Goose credentials so future sessions can start authenticated
without requiring manual `goose configure` each time.

## Prerequisites

- An API key for a supported LLM provider (Anthropic, OpenAI, or Google)

## Setup Steps

During first-run onboarding, run the credential handoff after the skillset has
uploaded successfully and `nori-broker onboarding complete` has returned
`{"onboarded":true}`.

### API Key

Goose requires three values: an API key, the provider name, and the model.

1. Obtain an API key from your LLM provider.
2. Hand it off:
   ```
   nori-broker onboarding handoff-provider --provider goose --type api-key --api-key "<API_KEY>" --goose-provider "<PROVIDER>" --goose-model "<MODEL>"
   ```

Supported providers: `anthropic`, `openai`, `google`.

Example with Anthropic:
```
nori-broker onboarding handoff-provider --provider goose --type api-key --api-key "sk-ant-..." --goose-provider "anthropic" --goose-model "claude-sonnet-4-20250514"
```

### Skip

If the user declines credential persistence:

```
nori-broker onboarding handoff-provider --provider goose --type skip
```

## Verify

```
nori-broker onboarding status
```

The `goose-api-key` integration should show `configured: true` unless the user skipped.
