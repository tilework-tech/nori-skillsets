#!/usr/bin/env python3
"""
Create a nori-skillsets release by pushing a git tag.

This script creates release tags that trigger the skillsets-release workflow.
The workflow handles building, testing, and publishing to npm.

Usage:
    # Dry run to see next version
    ./scripts/create_skillsets_release.py --dry-run --publish-release

    # Create next stable release (bumps minor version)
    ./scripts/create_skillsets_release.py --publish-release

    # Create next dev snapshot (for internal testing)
    ./scripts/create_skillsets_release.py --publish-next

    # Create specific version
    ./scripts/create_skillsets_release.py --version 1.2.0

    # Query current state
    ./scripts/create_skillsets_release.py --get-latest-stable
    ./scripts/create_skillsets_release.py --get-next-version
"""

import argparse
import json
import re
import subprocess
import sys
from typing import Optional


REPO = "tilework-tech/nori-skillsets"
BRANCH_REF = "heads/main"
TAG_PREFIX = "skillsets-v"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a tagged nori-skillsets release.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Preview what would be released
    %(prog)s --dry-run --publish-release

    # Create a stable release (e.g., 1.1.0 -> 1.2.0)
    %(prog)s --publish-release

    # Create a prerelease for testing (e.g., 1.1.0-next.1)
    %(prog)s --publish-next

    # Release a specific version
    %(prog)s --version 1.2.3

    # Check the latest stable version
    %(prog)s --get-latest-stable
""",
    )
    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="Print the version that would be used and exit before making changes.",
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--publish-next",
        action="store_true",
        help="Publish a -next.N prerelease for internal testing (tagged @next on npm).",
    )
    group.add_argument(
        "--publish-release",
        action="store_true",
        help="Publish the next stable release by bumping the minor version.",
    )
    group.add_argument(
        "--version",
        metavar="VERSION",
        help="Publish a specific version (e.g., 1.2.0 or 1.2.0-next.1).",
    )
    group.add_argument(
        "--get-latest-stable",
        action="store_true",
        help="Print the latest stable version from tags and exit.",
    )
    group.add_argument(
        "--get-next-version",
        action="store_true",
        help="Print the next -next.N version and exit.",
    )

    args = parser.parse_args(argv[1:])
    if not (
        args.publish_next
        or args.publish_release
        or args.version
        or args.get_latest_stable
        or args.get_next_version
    ):
        parser.error(
            "Must specify --publish-next, --publish-release, --version, "
            "--get-latest-stable, or --get-next-version."
        )
    return args


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    try:
        # Handle query-only flags first
        if args.get_latest_stable:
            latest = get_latest_release_version()
            if latest is None:
                print("0.0.0")
            else:
                print(latest)
            return 0

        if args.get_next_version:
            # Simulate --publish-next to get the version
            args.publish_next = True
            version = determine_version(args)
            print(version)
            return 0

        if args.version:
            version = args.version.lstrip("v")
            # Validate version format
            if not re.match(r"^\d+\.\d+\.\d+(-[a-zA-Z]+\.\d+)?$", version):
                raise ReleaseError(f"Invalid version format: {version}")
        else:
            version = determine_version(args)

        tag_name = f"{TAG_PREFIX}{version}"

        # Check if tag already exists
        if tag_exists(tag_name):
            raise ReleaseError(f"Tag {tag_name} already exists")

        print(f"Publishing version {version}")
        print(f"Tag name: {tag_name}")

        if args.dry_run:
            print("\n[DRY RUN] Would perform the following:")
            print(f"  1. Create annotated tag {tag_name}")
            print(f"  2. Push tag to origin")
            print(f"  3. Trigger skillsets-release workflow")
            return 0

        print("\nCreating and pushing tag...")
        create_and_push_tag(tag_name, version)

        print("\n" + "=" * 60)
        print(f"Release {version} tag created successfully!")
        print(f"   Tag: {tag_name}")
        print("")
        print("The skillsets-release workflow will now automatically:")
        print("  1. Run tests and validation")
        print("  2. Build the nori-skillsets package")
        if "-next." in version:
            print("  3. Publish to npm with @next tag")
        else:
            print("  3. Publish to npm with @latest tag")
            print("  4. Create GitHub Release")
        print("")
        print(f"Monitor progress at:")
        print(f"  https://github.com/{REPO}/actions")
        print("=" * 60)

    except ReleaseError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


class ReleaseError(RuntimeError):
    pass


def run_gh_api(
    endpoint: str, *, method: str = "GET", payload: Optional[dict] = None
) -> dict:
    """Execute a GitHub API call using the gh CLI."""
    command = [
        "gh",
        "api",
        endpoint,
        "--method",
        method,
        "-H",
        "Accept: application/vnd.github+json",
    ]
    json_payload = None
    if payload is not None:
        json_payload = json.dumps(payload)
        command.extend(["-H", "Content-Type: application/json", "--input", "-"])

    result = subprocess.run(command, text=True, capture_output=True, input=json_payload)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "gh api call failed"
        raise ReleaseError(message)
    try:
        return json.loads(result.stdout or "{}")
    except json.JSONDecodeError as error:
        raise ReleaseError("Failed to parse response from gh api.") from error


def run_git(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command."""
    result = subprocess.run(["git"] + args, text=True, capture_output=True)
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise ReleaseError(f"git {' '.join(args)}: {message}")
    return result


def tag_exists(tag_name: str) -> bool:
    """Check if a tag already exists."""
    try:
        run_gh_api(f"/repos/{REPO}/git/refs/tags/{tag_name}")
        return True
    except ReleaseError:
        return False


def create_and_push_tag(tag_name: str, version: str) -> None:
    """Create an annotated tag and push it to origin."""
    # Create annotated tag locally
    run_git(
        [
            "tag",
            "-a",
            tag_name,
            "-m",
            f"nori-skillsets release {version}",
        ]
    )

    # Push the tag
    run_git(["push", "origin", tag_name])


def determine_version(args: argparse.Namespace) -> str:
    """Determine the next version based on existing releases."""
    latest_version = get_latest_release_version()

    if latest_version is None:
        # No existing releases, start at 1.0.0
        if args.publish_release:
            return "1.0.0"
        else:
            return "1.0.0-next.1"

    major, minor, patch = parse_semver(latest_version)
    next_minor_version = format_version(major, minor + 1, 0)
    current_stable_version = format_version(major, minor, patch)

    if args.publish_release:
        return next_minor_version

    if args.publish_next:
        # For next releases, use the current stable version as base
        # e.g., if latest stable is 1.2.0, create 1.2.0-next.1, 1.2.0-next.2, etc.
        next_prefix = f"{current_stable_version}-next."
        tags = list_tags()
        highest_next = 0

        for version in tags:
            if version.startswith(next_prefix):
                suffix = version[len(next_prefix) :]
                try:
                    next_number = int(suffix)
                except ValueError:
                    continue
                highest_next = max(highest_next, next_number)

        return f"{next_prefix}{highest_next + 1}"

    # Should not reach here
    raise ReleaseError("Unable to determine version")


def list_tags() -> list[str]:
    """List all tags matching TAG_PREFIX, returning version strings."""
    tags: list[str] = []
    page = 1
    while True:
        try:
            response = run_gh_api(
                f"/repos/{REPO}/git/refs/tags?per_page=100&page={page}"
            )
            if not isinstance(response, list) or not response:
                break
            for ref in response:
                ref_name = ref.get("ref", "")
                if ref_name.startswith(f"refs/tags/{TAG_PREFIX}"):
                    version = ref_name[len(f"refs/tags/{TAG_PREFIX}") :]
                    tags.append(version)
            if len(response) < 100:
                break
            page += 1
        except ReleaseError:
            break
    return tags


def get_latest_release_version() -> Optional[str]:
    """Get the version of the latest stable release from git tags.

    Uses git tags instead of GitHub Releases to be robust against
    incomplete release workflows.
    """
    tags = list_tags()
    stable_versions: list[tuple[int, int, int]] = []

    for version in tags:
        # Skip prerelease versions (contain '-')
        if "-" in version:
            continue
        try:
            semver = parse_semver(version)
            stable_versions.append(semver)
        except ReleaseError:
            continue

    if not stable_versions:
        return None

    highest = max(stable_versions)
    return format_version(*highest)


def parse_semver(version: str) -> tuple[int, int, int]:
    """Parse a semver version string into components."""
    base_version = version.split("-")[0]
    parts = base_version.split(".")
    if len(parts) != 3:
        raise ReleaseError(f"Unexpected version format: {version}")
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError as error:
        raise ReleaseError(f"Version components must be integers: {version}") from error


def format_version(major: int, minor: int, patch: int) -> str:
    """Format version components into a version string."""
    return f"{major}.{minor}.{patch}"


if __name__ == "__main__":
    sys.exit(main(sys.argv))
