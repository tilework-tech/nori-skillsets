# Nori Skillsets — shared local runner layer
# See: docs/specs/shared-local-runner-layer.md

set shell := ["bash", "-euo", "pipefail", "-c"]

# Print curated repo orientation
help:
    #!/usr/bin/env bash
    set -euo pipefail
    cat <<'EOF'
    skillsets — Nori Skillsets CLI

    Manages AI agent skillsets (profiles, skills, registry operations).
    Published to npm as nori-skillsets. Aliases: sks, nori-skillset.

    Standard targets:
      just dev                   Build and run the CLI locally
      just test [-- args]        Run the test suite (vitest)
      just doctor                Verify local toolchain and dependencies

    Repo-specific targets:
      just build                 Full production build
      just lint                  Run all linters (eslint, prettier, tsc)
      just format                Auto-fix formatting (prettier + eslint)
    EOF

# Build and run the CLI locally
dev:
    npm run dev

# Run the test suite via vitest (pass extra args after --)
test *args:
    npx vitest run {{args}}

# Verify local toolchain and dependencies
doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    ok=true

    check() {
        if command -v "$1" > /dev/null 2>&1; then
            printf "  ✓ %-12s %s\n" "$1" "$("$1" --version 2>&1 | head -1)"
        else
            printf "  ✗ %-12s not found\n" "$1"
            ok=false
        fi
    }

    echo "Toolchain:"
    check node
    check npm
    check npx

    echo ""
    echo "Dependencies:"
    if [ -d node_modules ]; then
        printf "  ✓ %-12s installed\n" "node_modules"
    else
        printf "  ✗ %-12s missing — run 'npm install'\n" "node_modules"
        ok=false
    fi

    echo ""
    echo "TypeScript:"
    if npx tsc --version > /dev/null 2>&1; then
        printf "  ✓ %-12s %s\n" "tsc" "$(npx tsc --version 2>&1)"
    else
        printf "  ✗ %-12s not available\n" "tsc"
        ok=false
    fi

    echo ""
    if [ "$ok" = true ]; then
        echo "All checks passed."
    else
        echo "Some checks failed. See above."
        exit 1
    fi

# Full production build
build:
    npm run build

# Run all linters (eslint, prettier, tsc --noEmit)
lint:
    npm run lint

# Auto-fix formatting (prettier + eslint)
format:
    npm run format
