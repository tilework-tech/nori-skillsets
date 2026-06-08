#!/usr/bin/env python3
"""Tests for create_skillsets_release.py."""

import importlib.util
import os
import unittest
from unittest import mock

# Load the release script as a module (filename is a valid module name).
_SPEC = importlib.util.spec_from_file_location(
    "create_skillsets_release",
    os.path.join(os.path.dirname(__file__), "create_skillsets_release.py"),
)
release = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(release)


def _fake_refs(count: int) -> list[dict]:
    """Build a list of `count` tag refs as the GitHub git/refs/tags API returns them."""
    refs = [{"ref": f"refs/tags/{release.TAG_PREFIX}0.{i}.0"} for i in range(count)]
    # A non-matching ref must be filtered out.
    refs.append({"ref": "refs/tags/some-other-tag"})
    return refs


class ListTagsTest(unittest.TestCase):
    def test_makes_a_single_api_request_for_a_full_response(self):
        """The git/refs/tags endpoint ignores per_page/page and returns every ref
        in one response. list_tags must not fan out additional requests when a
        response is >= 100 items, otherwise it loops forever and gets rate limited.
        """

        def fake_run_gh_api(endpoint, *, method="GET", payload=None):
            if fake.call_count > 1:
                raise RuntimeError(
                    "fan-out detected: list_tags issued more than one request"
                )
            return _fake_refs(163)

        with mock.patch.object(
            release, "run_gh_api", side_effect=fake_run_gh_api
        ) as fake:
            tags = release.list_tags()

        self.assertEqual(fake.call_count, 1)
        # All 163 matching tags parsed, prefix stripped, non-matching ref dropped.
        self.assertEqual(len(tags), 163)
        self.assertIn("0.0.0", tags)
        self.assertIn("0.162.0", tags)
        self.assertNotIn("some-other-tag", tags)

    def test_returns_empty_when_api_call_fails(self):
        """A failed API call must degrade to an empty list, not raise, so callers
        (get_latest_release_version / determine_version) can fall back cleanly.
        """
        with mock.patch.object(
            release, "run_gh_api", side_effect=release.ReleaseError("boom")
        ):
            self.assertEqual(release.list_tags(), [])

    def test_returns_empty_for_non_list_response(self):
        """When the path matches a single ref the endpoint returns an object, not
        a list; list_tags must treat that as "no matching tags" rather than crash.
        """
        with mock.patch.object(
            release, "run_gh_api", return_value={"ref": "refs/tags/skillsets-v1.0.0"}
        ):
            self.assertEqual(release.list_tags(), [])


if __name__ == "__main__":
    unittest.main()
