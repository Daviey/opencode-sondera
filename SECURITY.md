# Security Policy

## Reporting a Vulnerability

Report security vulnerabilities by opening a GitHub Security Advisory:

https://github.com/Daviey/opencode-sondera/security/advisories/new

Do not file public issues for security bugs.

Include enough detail to reproduce the problem: affected version, relevant config, and steps to trigger it. We will acknowledge receipt within 48 hours and aim to respond with a fix or mitigation within 7 days.

## Supported Versions

Only the latest release receives security fixes.

## What We Scan

| Scanner | Scope | Frequency |
|---|---|---|
| CodeQL | TypeScript, GitHub Actions | Every push and PR |
| gitleaks | Full git history | Every push and PR |
| OSV Scanner | npm, Cargo | Weekly + every push |
| cargo audit | Rust dependencies | Weekly + every push |
| npm audit | npm dependencies | Weekly + every push |
| OpenSSF Scorecard | Repository posture | Weekly |

## Adjudication Architecture

The plugin sends tool calls to the Sondera harness server for Cedar policy evaluation. The harness runs as a local process and does not send data elsewhere unless you configure an external classifier.

The plugin fails open by default. If the harness is unreachable, the adapter is missing, or any error occurs during adjudication, tool calls proceed. Set `SONDERA_STRICT=1` to block calls on failure instead.
