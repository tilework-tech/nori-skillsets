#!/bin/bash

# Safeguard against accidental `npm publish`.
#
# Publishing is handled by the CI/CD pipeline via create_skillsets_release.py.
# This script prevents direct npm publish from succeeding.

echo "ERROR: Do not run 'npm publish' directly." >&2
echo "Use ./scripts/create_skillsets_release.py to create a release." >&2
exit 1
