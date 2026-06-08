#!/usr/bin/env python3
"""Tests for create_skillsets_release.py."""

import importlib.util
import os
import subprocess
import unittest
from unittest import mock

# Load the release script as a module (filename is a valid module name).
_SPEC = importlib.util.spec_from_file_location(
    "create_skillsets_release",
    os.path.join(os.path.dirname(__file__), "create_skillsets_release.py"),
)
release = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(release)


def _ls_remote_output(versions: list[str]) -> str:
    """Render `git ls-remote --tags` output for the given matching versions.

    Annotated tags emit both the tag ref and a peeled "^{}" ref; list_tags
    must dedupe those. A non-matching ref is included to exercise filtering.
    """
    lines = []
    for v in versions:
        sha = "0" * 40
        lines.append(f"{sha}\trefs/tags/{release.TAG_PREFIX}{v}")
        lines.append(f"{sha}\trefs/tags/{release.TAG_PREFIX}{v}^{{}}")
    lines.append(f"{'1' * 40}\trefs/tags/some-other-tag")
    return "\n".join(lines) + "\n"


def _completed(stdout: str, returncode: int = 0) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["git"], returncode=returncode, stdout=stdout, stderr=""
    )


class ListTagsTest(unittest.TestCase):
    def test_parses_remote_tags_and_dedupes_peeled_refs(self):
        """list_tags reads tags from the remote in a single call, strips the
        prefix, drops non-matching refs, and does not double-count the peeled
        "^{}" refs that annotated tags produce.
        """
        with mock.patch.object(
            release,
            "run_git",
            return_value=_completed(_ls_remote_output(["0.1.0", "0.2.0", "0.26.0"])),
        ) as run_git:
            tags = release.list_tags()

        self.assertEqual(run_git.call_count, 1)
        self.assertEqual(sorted(tags), ["0.1.0", "0.2.0", "0.26.0"])
        self.assertNotIn("some-other-tag", tags)

    def test_returns_empty_when_remote_query_fails(self):
        """A failed remote query degrades to an empty list so callers
        (get_latest_release_version / determine_version) can fall back cleanly.
        """
        with mock.patch.object(
            release, "run_git", return_value=_completed("", returncode=128)
        ):
            self.assertEqual(release.list_tags(), [])


if __name__ == "__main__":
    unittest.main()
