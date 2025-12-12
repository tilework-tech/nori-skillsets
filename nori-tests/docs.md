# Noridoc: nori-tests

Path: @/nori-tests

### Overview

Integration test specifications written in Markdown that validate end-to-end nori-profiles workflows. Tests are executed by the external `nori-tests` CLI tool, which spins up isolated Docker containers and has Claude Code execute the test instructions, verifying complete user workflows rather than isolated code units.

### How it fits into the larger codebase

This directory exists alongside @/tests (unit tests) but serves a different purpose. Unit tests in @/tests validate isolated functionality, while integration tests here validate complete multi-step user workflows like upgrade flows, multi-installation scenarios, and uninstall behavior. Tests run in Docker containers via the external `nori-tests` CLI (not part of this repository), which passes markdown test specs to claude-code and collects success/failure results. These tests complement the unit testing strategy by validating system invariants that span multiple commands and installation states. Tests consume Anthropic API credits and take several minutes each, so they're designed to run selectively (pre-release, after major changes) rather than on every commit. The test specifications reference the CLI commands defined in @/src/cli/commands and validate behavior of the installation system in @/src/cli.

### Core Implementation

Test files are markdown documents with:
- Clear step-by-step bash commands to execute
- Verification steps after each major action (checking files exist, configs are correct, etc.)
- Explicit success criteria defining what must be true
- Error handling instructions for failures
- JSON status file output (`/tmp/.nori-test-status.json`) with success/failure and error messages

The nori-tests CLI (external tool):
1. Reads markdown test specification
2. Spins up isolated Docker container
3. Passes markdown content to claude-code
4. Claude executes commands and verifies results
5. Claude writes status file indicating success/failure
6. Results collected and reported

Current test files:
- `upgrade-multi-install-uninstall.md` - Comprehensive test covering upgrade from npm version to built version, profile switching, multi-installation scenarios (nested directories with claude-code and cursor-agent), uninstall with multiple locations, and slash command verification

### Things to Know

Tests are expensive (API credits + time), so they should be:
- Run before major releases
- Run after significant changes to installation/uninstall logic
- Run when validating multi-agent support
- NOT run on every commit

Test specifications must be very specific:
- Full file paths, exact command arguments
- Verification after each step (don't assume success)
- Test actual behavior, not just that commands completed
- Handle partial failures gracefully
- Write clear error messages to status file

The `--keep-containers` flag is useful for debugging failed tests by allowing inspection of container state post-execution. Tests validate system invariants like "upgrade removes old artifacts", "multi-installation warns about conflicts", and "uninstall correctly identifies which agent to remove when multiple installations exist".

Tests reference installation behaviors defined in @/src/cli/commands/install, uninstall logic in @/src/cli/commands/uninstall, and profile switching in @/src/cli/commands/switch-profile. The upgrade-multi-install-uninstall test specifically validates that the multi-installation detection and user warnings (added in recent PRs) work correctly across nested directory scenarios.
