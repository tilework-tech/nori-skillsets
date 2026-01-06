#!/bin/bash

# Interactive Prepublish Script
#
# This script runs before npm publish and:
# 1. Prompts the user whether to update release notes
# 2. If yes, runs headless Claude to generate release notes
# 3. Prompts whether to stage and commit the changes
# 4. If no to commit, aborts the publish

set -e  # Exit on any error

# ============================================================================
# Check for required tools
# ============================================================================
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required but not installed."
  echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Nori Prepublish${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# ============================================================================
# STEP 1: Prompt for release notes update
# ============================================================================
echo -e "${YELLOW}Do you want to update release notes? [y/n]${NC}"
read -r UPDATE_RELEASE_NOTES

if [[ "$UPDATE_RELEASE_NOTES" =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${BLUE}Generating release notes with Claude...${NC}"
  echo ""
  
  # Run headless Claude to update release notes
  # Note: --allowedTools must include all bash commands Claude needs to run
  claude -p 'Read and follow release-notes-update.md exactly.' --allowedTools 'Read,Edit,Write,Bash(npm view:*),Bash(git log:*),Bash(git diff:*),Bash(git add:*),Grep,Glob'
  
  echo ""
  echo -e "${GREEN}Release notes updated.${NC}"
  echo ""
  
  # ============================================================================
  # STEP 2: Prompt for staging and committing
  # ============================================================================
  echo -e "${YELLOW}Do you want to stage and commit the release notes change? [y/n]${NC}"
  read -r COMMIT_CHANGES
  
  if [[ "$COMMIT_CHANGES" =~ ^[Yy]$ ]]; then
    # Get version from package.json
    VERSION=$(jq -r .version package.json)
    
    echo ""
    echo -e "${BLUE}Committing release notes...${NC}"
    
    git add release-notes.txt
    git commit -m "docs: Update release notes for v${VERSION}"
    
    echo -e "${GREEN}Release notes committed.${NC}"
    echo ""
  else
    # Get version for the manual commit message hint
    VERSION=$(jq -r .version package.json)
    
    # Unstage release-notes.txt if it was staged by Claude
    git restore --staged release-notes.txt 2>/dev/null || true
    
    echo ""
    echo -e "${RED}Publish aborted.${NC}"
    echo -e "Release notes were updated but not committed."
    echo -e "To discard changes: git checkout release-notes.txt"
    echo -e "To commit manually: git add release-notes.txt && git commit -m \"docs: Update release notes for v${VERSION}\""
    echo ""
    exit 1
  fi
else
  echo ""
  echo -e "${BLUE}Skipping release notes update.${NC}"
  echo ""
fi

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  Prepublish complete${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
