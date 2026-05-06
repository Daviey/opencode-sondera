# Adapter Protocol

The adapter binary (`sondera-opencode-adapter`) supports three subcommands.

## Health check

```
$ sondera-opencode-adapter health
```

Exit 0 means healthy, non-zero means unreachable. No stdin/stdout interaction. The plugin uses this once at startup to determine whether the harness server is available.

## Stream mode (NDJSON)

```
$ sondera-opencode-adapter stream
```

Reads newline-delimited JSON from stdin, writes newline-delimited JSON to stdout. Keeps the harness connection alive between calls. The process reads until stdin is closed.

Request lines (stdin):
```json
{"trajectory_id":"s1","agent_id":"opencode-user","tool":"bash","action":"ShellCommand","args":{"command":"ls"},"event_type":"before"}
```

Response lines (stdout):
```json
{"decision":"allow","reason":null,"annotations":[]}
```

If the harness connection drops mid-stream, the adapter returns an error response and reconnects on the next request. Invalid input lines produce an `allow` response with a reason describing the parse error.

Concurrent requests must be serialized at the caller side. The TS client uses a promise chain mutex (see ADR-019).

## Oneshot adjudication

```
$ echo '<json>' | sondera-opencode-adapter adjudicate
<json response>
```

Request (stdin):
```json
{
  "trajectory_id": "session-id",
  "agent_id": "opencode-username",
  "tool": "bash",
  "action": "ShellCommand",
  "args": { "command": "ls", "workdir": "/tmp" },
  "cwd": "/home/user/project",
  "event_type": "before"
}
```

Response (stdout):
```json
{
  "decision": "allow",
  "reason": null,
  "annotations": [
    { "policy_id": "default-permit", "description": "Permit all actions..." }
  ]
}
```

`decision` is one of: `allow`, `deny`, `escalate`.

## Auto-detection

The client attempts stream mode on the first adjudicate call. If the adapter does not support the `stream` subcommand (old binary), the process exits immediately and the client falls back to oneshot for all future calls. This detection happens once and the choice is cached for the session lifetime.
