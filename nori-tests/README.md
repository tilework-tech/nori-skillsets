# Nori Profiles Integration Tests

This directory contains integration test specifications for validating nori-profiles installation, upgrade, multi-installation, and uninstall flows.

## What Are These Tests?

These are **test specifications** written in Markdown that describe comprehensive end-to-end scenarios. They are designed to be executed by the `nori-tests` CLI tool, which:

1. Spins up an isolated Docker container
2. Passes the markdown content to `claude-code`
3. Claude Code executes all the commands and verifies the results
4. Claude writes a status file indicating success or failure
5. Results are collected and reported

## How to Run

### Prerequisites

- Docker running locally
- Valid Anthropic API key (`ANTHROPIC_API_KEY` environment variable)
- nori-tests CLI installed (`npm install -g nori-tests`)

### Run All Tests

```bash
nori-tests nori-tests/
```

### Run a Specific Test

```bash
nori-tests nori-tests/upgrade-multi-install-uninstall.md
```

### Run with JSON Report

```bash
nori-tests nori-tests/ --output report.json
```

### Keep Containers for Debugging

```bash
nori-tests nori-tests/ --keep-containers
```

## Test Files

- **upgrade-multi-install-uninstall.md** - Comprehensive test covering:
  - Upgrade flow from previous npm version to built version
  - Profile switching
  - Multi-installation scenarios (nested directories)
  - Cursor-agent installation
  - Uninstall with multiple install locations
  - Slash command verification

## Cost Considerations

These tests consume Anthropic API credits as they run claude-code in Docker containers. Each test can take several minutes and use multiple API calls. Consider running them:

- Before major releases
- After significant changes to installation/uninstall logic
- When validating multi-agent support
- Not on every commit (they're expensive!)

## Test Format

Each test file is a markdown document with:

1. **Clear title** describing what's being tested
2. **Step-by-step instructions** with exact commands to run
3. **Verification steps** after each major action
4. **Explicit success criteria** - what should be true when complete
5. **Error handling** - what to do if steps fail

## Writing New Tests

When writing new integration tests:

- Be very specific with commands (full paths, exact arguments)
- Include verification after each major step
- Test actual behavior, not just that commands run
- Handle partial failures gracefully
- Write clear error messages in the status file when failures occur
- Keep tests focused but comprehensive (consolidate related scenarios)

## Troubleshooting

**Test fails with "Docker not found"**
- Ensure Docker is running: `docker ps`

**Test fails with "API key not set"**
- Set environment variable: `export ANTHROPIC_API_KEY=your-key`

**Test passes but behavior seems wrong**
- Use `--keep-containers` flag to inspect the container state
- Check the container logs for detailed output

**Test is too expensive**
- Consider splitting into smaller, more focused tests
- Run less frequently
- Use `--dry-run` to discover tests without running them
