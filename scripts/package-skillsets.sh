#!/bin/bash

# Package Skillsets Script
#
# This script creates the nori-skillsets npm package from the build output.
# It creates a minimal package containing only the seaweed CLI.
#
# Usage:
#   ./scripts/package-skillsets.sh
#   SKILLSETS_VERSION=1.0.0 ./scripts/package-skillsets.sh
#
# Environment variables:
#   SKILLSETS_VERSION - Version for the nori-skillsets package (default: 1.0.0)

set -e  # Exit on any error

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"
STAGING_DIR="$DIST_DIR/nori-skillsets-staging"
BUILD_DIR="$PROJECT_ROOT/build"

# Version can be set via environment variable, defaults to 1.0.0
VERSION="${SKILLSETS_VERSION:-1.0.0}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Package nori-skillsets${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ============================================================================
# Verify build exists
# ============================================================================

if [[ ! -d "$BUILD_DIR" ]]; then
  echo -e "${RED}ERROR: Build directory not found at $BUILD_DIR${NC}"
  echo "Run 'npm run build' first."
  exit 1
fi

if [[ ! -f "$BUILD_DIR/src/cli/seaweed.js" ]]; then
  echo -e "${RED}ERROR: seaweed.js not found in build output${NC}"
  echo "Run 'npm run build' first."
  exit 1
fi

# ============================================================================
# Create staging directory
# ============================================================================

echo -e "${BLUE}[1/4] Creating staging directory...${NC}"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"

# ============================================================================
# Copy build output
# ============================================================================

echo -e "${BLUE}[2/4] Copying build output...${NC}"

# Copy the entire build directory (seaweed depends on shared modules)
cp -r "$BUILD_DIR" "$STAGING_DIR/"

# Copy README if it exists
if [[ -f "$PROJECT_ROOT/README.md" ]]; then
  cp "$PROJECT_ROOT/README.md" "$STAGING_DIR/"
fi

echo -e "${GREEN}  Copied build directory${NC}"

# ============================================================================
# Generate package.json for nori-skillsets
# ============================================================================

echo -e "${BLUE}[3/4] Generating package.json...${NC}"

# Read dependencies from the main package.json
# We need commander, node-fetch, and other runtime dependencies
MAIN_PACKAGE_JSON="$PROJECT_ROOT/package.json"

# Extract dependencies using node (more reliable than jq for complex JSON)
DEPENDENCIES=$(node -e "
const pkg = require('$MAIN_PACKAGE_JSON');
const deps = pkg.dependencies || {};
// Include all dependencies - seaweed uses shared modules that may need them
console.log(JSON.stringify(deps, null, 2));
")

cat > "$STAGING_DIR/package.json" << EOF
{
  "name": "nori-skillsets",
  "version": "$VERSION",
  "description": "Seaweed CLI - Registry Operations for Nori Profiles and Skills",
  "type": "module",
  "bin": {
    "seaweed": "./build/src/cli/seaweed.js",
    "nori-skillsets": "./build/src/cli/seaweed.js"
  },
  "keywords": [
    "claude code",
    "skills",
    "profiles",
    "registry",
    "seaweed",
    "nori"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/nori-dot-ai/skillsets"
  },
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "dependencies": $DEPENDENCIES
}
EOF

echo -e "${GREEN}  Generated package.json (version: $VERSION)${NC}"

# ============================================================================
# Create npm tarball
# ============================================================================

echo -e "${BLUE}[4/4] Creating npm tarball...${NC}"

cd "$STAGING_DIR"
npm pack --pack-destination "$DIST_DIR"

TARBALL_NAME="nori-skillsets-${VERSION}.tgz"
echo -e "${GREEN}  Created: $DIST_DIR/$TARBALL_NAME${NC}"

# ============================================================================
# Summary
# ============================================================================

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  Package Complete${NC}"
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
