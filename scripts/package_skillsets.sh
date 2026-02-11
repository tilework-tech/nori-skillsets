#!/bin/bash

# Package Skillsets Script
#
# This script creates the nori-skillsets npm package from the build output.
# It creates a minimal package containing only the nori-skillsets CLI.
#
# The script uses the main package.json directly, which now contains all
# the necessary metadata for publishing. The only modification made is
# overriding the version from the SKILLSETS_VERSION environment variable.
#
# Usage:
#   SKILLSETS_VERSION=1.0.0 ./scripts/package_skillsets.sh
#
# Environment variables:
#   SKILLSETS_VERSION - Version for the nori-skillsets package (required)

set -e  # Exit on any error

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"
STAGING_DIR="$DIST_DIR/nori-skillsets-staging"
BUILD_DIR="$PROJECT_ROOT/build"
MAIN_PACKAGE_JSON="$PROJECT_ROOT/package.json"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Version must be set via environment variable
if [[ -z "${SKILLSETS_VERSION:-}" ]]; then
  echo -e "${RED}ERROR: SKILLSETS_VERSION environment variable is required${NC}"
  echo "Usage: SKILLSETS_VERSION=1.0.0 ./scripts/package_skillsets.sh"
  exit 1
fi
VERSION="$SKILLSETS_VERSION"

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Package nori-skillsets${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ============================================================================
# Verify prerequisites
# ============================================================================

if [[ ! -d "$BUILD_DIR" ]]; then
  echo -e "${RED}ERROR: Build directory not found at $BUILD_DIR${NC}"
  echo "Run 'npm run build' first."
  exit 1
fi

if [[ ! -f "$BUILD_DIR/src/cli/nori-skillsets.js" ]]; then
  echo -e "${RED}ERROR: nori-skillsets.js not found in build output${NC}"
  echo "Run 'npm run build' first."
  exit 1
fi

if [[ ! -f "$MAIN_PACKAGE_JSON" ]]; then
  echo -e "${RED}ERROR: Main package.json not found at $MAIN_PACKAGE_JSON${NC}"
  exit 1
fi

# ============================================================================
# Create staging directory
# ============================================================================

echo -e "${BLUE}[1/4] Creating staging directory...${NC}"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
echo -e "${GREEN}✓ Staging directory created${NC}"

# ============================================================================
# Copy build output
# ============================================================================

echo -e "${BLUE}[2/4] Copying build output...${NC}"

# Copy the entire build directory (nori-skillsets depends on shared modules)
cp -r "$BUILD_DIR" "$STAGING_DIR/"

# Copy README if it exists
if [[ -f "$PROJECT_ROOT/README.md" ]]; then
  cp "$PROJECT_ROOT/README.md" "$STAGING_DIR/"
fi

echo -e "${GREEN}✓ Build directory copied${NC}"

# ============================================================================
# Generate package.json from main package.json
# ============================================================================

echo -e "${BLUE}[3/4] Generating package.json...${NC}"

# Use node to:
# 1. Read the main package.json
# 2. Override version with SKILLSETS_VERSION
# 3. Remove devDependencies (not needed for published package)
# 4. Keep only lifecycle scripts (postinstall, preinstall, install)
# 5. Write the result
node -e "
const fs = require('fs');

// Read main package.json
const pkg = JSON.parse(fs.readFileSync('$MAIN_PACKAGE_JSON', 'utf-8'));

// Override version
pkg.version = '$VERSION';

// Remove devDependencies
delete pkg.devDependencies;

// Keep only lifecycle scripts needed at install time
const lifecycleScripts = ['preinstall', 'install', 'postinstall'];
if (pkg.scripts) {
  const newScripts = {};
  for (const key of lifecycleScripts) {
    if (pkg.scripts[key]) {
      newScripts[key] = pkg.scripts[key];
    }
  }
  if (Object.keys(newScripts).length > 0) {
    pkg.scripts = newScripts;
  } else {
    delete pkg.scripts;
  }
}

// Write output
fs.writeFileSync('$STAGING_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('  Version: $VERSION');
console.log('  Dependencies included:');
for (const [name, ver] of Object.entries(pkg.dependencies)) {
  console.log('    - ' + name + ': ' + ver);
}
"

echo -e "${GREEN}✓ Generated package.json (version: $VERSION)${NC}"

# ============================================================================
# Create npm tarball
# ============================================================================

echo -e "${BLUE}[4/4] Creating npm tarball...${NC}"

cd "$STAGING_DIR"
npm pack --pack-destination "$DIST_DIR"

TARBALL_NAME="nori-skillsets-${VERSION}.tgz"

# Verify tarball was created
if [[ ! -f "$DIST_DIR/$TARBALL_NAME" ]]; then
  echo -e "${RED}ERROR: Expected tarball not found at $DIST_DIR/$TARBALL_NAME${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Created: $DIST_DIR/$TARBALL_NAME${NC}"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  ✓ Package Complete${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "Staging directory: $STAGING_DIR"
echo "Tarball: $DIST_DIR/$TARBALL_NAME"
echo ""
echo "To test locally:"
echo "  npm install -g $DIST_DIR/$TARBALL_NAME"
echo ""
echo "To publish:"
echo "  npm publish $DIST_DIR/$TARBALL_NAME --access public"
echo ""
