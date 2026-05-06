# Example Policies

The harness ships with ~70 Cedar policies across five files. This page walks through what they can do so you can write your own or understand what the defaults catch.

## Policy Evaluation Model

Cedar uses a default-permit model with targeted `forbid` overrides. A single matching `forbid` wins over any number of `permit` rules. The harness evaluates all policies for each tool call.

Each tool call gets a `context` populated by three sources:

- **YARA signatures**: pattern matching on command strings, file content, and URLs. Provides `severity` (0-4) and `categories` (e.g. `exfiltration`, `command_injection`, `obfuscation`).
- **Ollama classifiers** (optional): data sensitivity labels (`Public`, `Internal`, `Confidential`, `HighlyConfidential`) and code policy compliance checks. Falls back to safe defaults when Ollama is not running.
- **Trajectory state**: taint tracking, step count, and the high-water-mark sensitivity label across the session.

## What the Default Policies Block

### Destructive commands

Block `rm -rf`, `git push --force`, `git reset --hard`, `docker system prune`, `terraform destroy`, `DROP TABLE`, `kill -9`, and similar commands that cause irreversible damage.

```cedar
@id("forbid-rm-rf")
forbid (principal, action == Action::"ShellCommand", resource)
when {
    context.command like "*rm -rf *" ||
    context.command like "*rm -fr *" ||
    context.command like "*rm -Rf *"
};
```

### Shell injection and obfuscation

Block command chaining, reverse shells, base64-encoded payloads, and other patterns that hide intent.

```cedar
@id("forbid-shell-command-injection")
forbid (principal, action == Action::"ShellCommand", resource)
when {
    context.signature.categories.contains("command_injection")
};
```

### Credential access

Block reading `.env`, private keys (`.pem`, `.key`), cloud config files, and writing secrets into source code.

```cedar
@id("forbid-private-key-read")
forbid (principal, action == Action::"FileRead", resource)
when {
    context.path like "*.pem" ||
    context.path like "*.key" ||
    context.path like "*.p12"
};
```

### Data exfiltration

Block `curl`/`wget` to paste sites, DNS tunneling, and network commands on sensitive trajectories.

```cedar
@id("ifc-forbid-shell-network-highly-confidential")
forbid (principal, action == Action::"ShellCommand", resource)
when {
    resource.label == Label::"HighlyConfidential" &&
    (context.command like "*curl *" ||
     context.command like "*wget *" ||
     context.command like "*ssh *" ||
     context.command like "*nc *")
};
```

### Web fetch security

Block fetching from malicious domains, obfuscated URLs, and all web requests when the trajectory carries highly confidential data.

```cedar
@id("ifc-forbid-webfetch-highly-confidential")
forbid (principal, action == Action::"WebFetch", resource)
when {
    resource.label == Label::"HighlyConfidential"
};
```

### Supply chain attacks

Block typosquatted package names, command injection in install flags, dependency file tampering, and malicious build scripts.

```cedar
@id("forbid-suspicious-package-install-obfuscated")
forbid (principal, action == Action::"ShellCommand", resource)
when {
    (context.command like "*pip install*" ||
     context.command like "*npm install*") &&
    context.signature.categories.contains("obfuscation")
};
```

### Insecure code generation

Block writing files with injection vulnerabilities (SQL injection, XSS), hardcoded secrets, weak cryptography, and missing access control. Checks are scoped to relevant file types.

```cedar
@id("forbid-source-write-secrets-python")
forbid (principal, action in [Action::"FileWrite", Action::"FileEdit"], resource)
when {
    context.path like "*.py" &&
    context.signature.categories.contains("secrets_detection")
};
```

### Information flow control

Enforce a simplified Bell-LaPadula model: once a trajectory ingests confidential data, outbound channels (web fetches, network commands) are restricted. Highly confidential trajectories get full network lockdown.

```cedar
@id("forbid-file-write-hc-to-public")
forbid (principal, action in [Action::"FileWrite", Action::"FileEdit"], resource)
when {
    context.label == Label::"HighlyConfidential" &&
    resource.label == Label::"Public"
};
```

### Critical file protection

Block deletion of `.gitignore`, `Dockerfile`, CI/CD configs, database migrations, lock files, and security configuration.

```cedar
@id("forbid-delete-lockfile")
forbid (principal, action == Action::"FileDelete", resource)
when {
    context.path like "*package-lock.json" ||
    context.path like "*Cargo.lock" ||
    context.path like "*go.sum"
};
```

### Runaway agent protection

Limit step counts on sensitive trajectories to bound the blast radius.

```cedar
@id("forbid-tainted-trajectory-runaway")
forbid (principal, action in [Action::"ShellCommand", Action::"WebFetch"], resource)
when {
    resource.label == Label::"HighlyConfidential" &&
    resource.step_count > 50
};
```

## Writing Custom Policies

Custom policies go in a directory and are loaded at harness startup:

```bash
sondera-harness-server --policy-path ./my-policies/ --socket /tmp/sondera-custom.sock
```

### Available actions

| Action | Fires | Context fields |
|--------|-------|----------------|
| `ShellCommand` | before execution | `command`, `working_dir` |
| `ShellCommandOutput` | after execution | `command`, `exit_code`, `stdout`, `stderr` |
| `WebFetch` | before fetch | `url`, `prompt` |
| `WebFetchOutput` | after fetch | `url`, `code`, `result` |
| `FileRead` | before read | `path` |
| `FileWrite` | before write | `path`, `content` |
| `FileEdit` | before edit | `path`, `old_content`, `new_content` |
| `FileDelete` | before delete | `path` |

### Available context

```
context.signature.matches      // number of YARA matches
context.signature.severity     // 0=None 1=Low 2=Medium 3=High 4=Critical
context.signature.categories   // Set<String> of YARA categories
context.policy.compliant       // bool from Ollama code evaluation
context.policy.violations      // Set<String> of violation codes (SC2-SC7)
context.label                  // sensitivity label on this request
context.command                // shell command string
context.path                   // file path
context.url                    // URL for web operations
```

### Resource fields

```
resource.label        // trajectory sensitivity (high-water mark)
resource.step_count   // number of actions in this trajectory
resource.taints       // Set<Taint> of accumulated taint indicators
```

### Example: block all npm installs

```cedar
permit (principal, action, resource);

@id("forbid-npm-install")
forbid (principal, action == Action::"ShellCommand", resource)
when {
    context.command like "*npm install*"
};
```

### Example: block writing to production config

```cedar
@id("forbid-prod-config-edit")
forbid (principal, action in [Action::"FileWrite", Action::"FileEdit"], resource)
when {
    context.path like "*/config/production*"
};
```

### Example: block all file reads outside the project

```cedar
@id("forbid-read-outside-project")
forbid (principal, action == Action::"FileRead", resource)
when {
    context.path like "/etc/*" ||
    context.path like "*ssh/*" ||
    context.path like "*aws/credentials*"
};
```
