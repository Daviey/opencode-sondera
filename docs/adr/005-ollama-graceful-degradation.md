# ADR-005: Ollama Graceful Degradation

Date: 2025-03

## Context

The Sondera harness uses Ollama (a local LLM) for two classifiers: data sensitivity labeling (Public/Internal/Confidential/HighlyConfidential) and secure code policy evaluation (compliant/violating). When Ollama is not running, these classifiers fail.

## Decision

Patch the harness to catch Ollama errors and fall back to safe defaults. Data sensitivity defaults to `Public` (least restrictive label). Secure code policy defaults to `compliant` (no violations detected).

Cedar policies and YARA signature scanning work without Ollama. They are deterministic and don't require an LLM. The LLM classifiers add defense-in-depth but are not required for basic protection.

## Consequences

Users do not need to run Ollama to get value from Sondera. The fix adds `classify_graceful()` and `evaluate_policy_graceful()` helper methods in `transform.rs` that catch errors and return defaults, replacing 16 direct call sites.
