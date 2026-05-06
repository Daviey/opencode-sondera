# ADR-018: Codecov for Coverage Reporting

Date: 2026-05

## Context

CI previously generated a `coverage-badge.json` file and committed it back to main via `git push`. This failed because main is a protected branch requiring PRs and status checks. The commit-based approach also produced stale badges and required git history pollution.

## Decision

Use [Codecov](https://codecov.io) for coverage reporting. The CI workflow runs `bun test --coverage --coverage-reporter=lcov` and uploads the LCOV report via `codecov/codecov-action@v5`. The `CODECOV_TOKEN` secret authenticates the upload.

The README badge points to `https://codecov.io/gh/Daviey/opencode-sondera/branch/main/graph/badge.svg`.

## Alternatives considered

Custom badge commit: failed due to branch protection. Would also require `contents: write` permission and produced noisy git history.

Shields.io endpoint badge: would need a static JSON file hosted somewhere. Adds hosting complexity.

Upload artifact only: no persistent badge or PR coverage comments.

## Consequences

Codecov provides: persistent coverage badge, PR coverage diff comments, trend tracking, and file-level coverage breakdown. No git history pollution. Free for public repos.

Requires `CODECOV_TOKEN` repository secret to be set. The `fail_ci_if_error: false` setting means CI passes even if Codecov is unreachable.
