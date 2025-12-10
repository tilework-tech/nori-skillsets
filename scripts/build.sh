#!/bin/bash

# Plugin Package Build Script
#
# This script orchestrates the complete build process for the Nori plugin package.
# It compiles TypeScript, resolves path aliases, bundles paid skills, and prepares
# all configuration files for installation.
#
# Build Pipeline:
# 1. Clean build directory
# 2. TypeScript compilation (tsc)
# 3. Path alias resolution (tsc-alias)
# 4. Paid skills bundling (esbuild)
# 5. File permissions setup
# 6. Configuration file copying
# 7. Version substitution

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Nori Plugin Package Build${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ============================================================================
# STEP 1: Clean Build Directory
# ============================================================================
echo -e "${BLUE}[1/7] Cleaning build directory...${NC}"
rm -rf build/
echo -e "${GREEN}✓ Build directory cleaned${NC}"
echo ""

# ============================================================================
# STEP 2: TypeScript Compilation
# ============================================================================
echo -e "${BLUE}[2/7] Compiling TypeScript...${NC}"
tsc
echo -e "${GREEN}✓ TypeScript compilation complete${NC}"
echo ""

# ============================================================================
# STEP 3: Path Alias Resolution
# ============================================================================
# Converts TypeScript path aliases (@/* -> src/*) to relative paths
# Example: '@/api/index.js' becomes '../../../../../api/index.js'
echo -e "${BLUE}[3/7] Resolving path aliases...${NC}"
tsc-alias --verbose

# Verify no @/ imports remain in production JS files (not test files)
# This catches cases where tsc-alias silently fails to resolve paths
UNRESOLVED=$(grep -r "from ['\"]@/" build/src --include="*.js" | grep -v "\.test\.js" | grep -v "vi\.mock" || true)
if [ -n "$UNRESOLVED" ]; then
  echo -e "${RED}ERROR: Unresolved @/ imports found after tsc-alias:${NC}"
  echo "$UNRESOLVED"
  echo -e "${RED}This indicates tsc-alias failed to resolve path aliases.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Path aliases resolved${NC}"
echo ""

# ============================================================================
# STEP 4: Bundle Scripts
# ============================================================================
# Uses esbuild to create standalone executables for:
# - Paid skills: script files that need API access
# - Hook scripts: scripts that run on Claude Code events
# - Inlines all dependencies (minimist, API client, config)
# - Resolves all imports at build time
# - Produces single-file executables
# See: src/scripts/bundle-skills-README.md for details
echo -e "${BLUE}[4/7] Bundling scripts...${NC}"
node build/src/scripts/bundle-skills.js
echo -e "${GREEN}✓ Scripts bundled${NC}"
echo ""

# ============================================================================
# STEP 5: Set File Permissions
# ============================================================================
# Make executables runnable with chmod +x
echo -e "${BLUE}[5/7] Setting file permissions...${NC}"

# Core executables
chmod +x build/src/cli/cli.js
chmod +x build/src/cli/commands/install/install.js
chmod +x build/src/cli/commands/uninstall/uninstall.js

# Hook scripts
chmod +x build/src/cli/features/hooks/config/autoupdate.js
chmod +x build/src/cli/features/hooks/config/summarize.js
chmod +x build/src/cli/features/hooks/config/summarize-notification.js

# Paid skill scripts (all script.js files in paid-* directories within profiles)
find build/src/cli/features/profiles/config -path '*/skills/paid-*/script.js' -exec chmod +x {} \; 2>/dev/null || true

echo -e "${GREEN}✓ File permissions set${NC}"
echo ""

# ============================================================================
# STEP 6: Copy Configuration Files
# ============================================================================
# TypeScript only compiles .ts files, so we need to manually copy
# configuration files (.md, .sh) to the build directory
echo -e "${BLUE}[6/7] Copying configuration files...${NC}"

# Create required directories
mkdir -p build/src/cli/features/hooks/config
mkdir -p build/src/cli/features/statusline/config
mkdir -p build/src/cli/features/profiles/config
mkdir -p build/src/cli/features/slashcommands/config

# Copy configuration files for specific features that still have config dirs
cp src/cli/features/hooks/config/*.sh build/src/cli/features/hooks/config/ 2>/dev/null || true
cp src/cli/features/statusline/config/*.sh build/src/cli/features/statusline/config/ 2>/dev/null || true
cp src/cli/features/slashcommands/config/*.md build/src/cli/features/slashcommands/config/ 2>/dev/null || true

# Copy entire profile directories (which contain skills, subagents, slashcommands, CLAUDE.md)
cp -r src/cli/features/profiles/config/* build/src/cli/features/profiles/config/ 2>/dev/null || true

# Make shell scripts executable
chmod +x build/src/cli/features/hooks/config/*.sh 2>/dev/null || true
chmod +x build/src/cli/features/statusline/config/*.sh 2>/dev/null || true

echo -e "${GREEN}✓ Configuration files copied${NC}"
echo ""

# ============================================================================
# STEP 7: Version Substitution
# ============================================================================
# Replace __VERSION__ placeholder with actual version from package.json
# This allows the status line to display the current package version
echo -e "${BLUE}[7/7] Substituting version strings...${NC}"

VERSION=$(jq -r .version package.json)
perl -pi -e "s/__VERSION__/v${VERSION}/g" build/src/cli/features/statusline/config/nori-statusline.sh

echo -e "${GREEN}✓ Version substituted (v${VERSION})${NC}"
echo ""

# ============================================================================
# Build Complete
# ============================================================================
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  ✓ Build Complete${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "Build output: ${BLUE}build/${NC}"
echo -e "Next steps:"
echo -e "  - Run ${YELLOW}node build/src/cli/cli.js${NC} to install"
echo -e "  - Run ${YELLOW}npm test${NC} to run tests"
echo ""
