---
name: {{agentId}}-integration
description: Credential setup for {{agentName}} in Nori Sessions
---

# {{agentName}} Integration Setup

## What This Does

Configures {{agentName}} credentials so future sessions can start authenticated.

## Prerequisites

- An API key for a supported LLM provider

## Setup Steps

During first-run onboarding, run the credential handoff after the skillset has
uploaded successfully and `nori-broker onboarding complete` has returned
`{"onboarded":true}`.

### API Key

1. Obtain an API key from your LLM provider.
2. Hand it off:
   ```
   nori-broker onboarding handoff-provider --provider {{agentId}} --type api-key --api-key "<API_KEY>"
   ```

## Verify

```
nori-broker onboarding status
```

The `{{authIntegrationId}}` integration should show `configured: true`.
