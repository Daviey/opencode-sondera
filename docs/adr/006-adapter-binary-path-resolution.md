# ADR-006: Adapter Binary Path Resolution

Date: 2025-03

## Context

The plugin needs to find the adapter binary. On NixOS, `~/.local/bin` is typically not on `PATH`, and the binary links against Nix store OpenSSL.

## Decision

Check these locations in order:

1. `SONDERA_ADAPTER_PATH` environment variable (explicit override)
2. `$HOME/.local/bin/sondera-opencode-adapter` (default install location)
3. `sondera-opencode-adapter` (relies on PATH)

The release binary built inside nix-shell has RPATH baked in, so it works outside nix-shell. Users can install it to `~/.local/bin` without modifying their PATH; the plugin checks there explicitly.

## Consequences

The path resolution works on NixOS, macOS, and standard Linux distributions without additional configuration. The fallback to PATH lookup handles custom install locations.
