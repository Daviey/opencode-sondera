# Dry Run Mode

When `SONDERA_DRY_RUN=1` is set, the plugin sends all tool calls to the harness for adjudication but does not throw on deny. Instead, it sends a warning toast and the tool call proceeds. This lets teams evaluate policy impact before enforcement.

The deny path replaces the throw with a toast notification prefixed "dry-run". Audit log entries record `dry_run: true` so dry-run denials can be distinguished from real enforcement in downstream analysis.

No changes to the adapter or harness are needed. The implementation is a single branch in the deny path of `tool.execute.before`.

Teams typically run dry-run for a week or two, review the audit log for false positives, tune policies, then switch to enforcement mode.
