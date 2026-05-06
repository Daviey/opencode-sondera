use anyhow::Result;
use serde::{Deserialize, Serialize};
use sondera_harness::{
    Action, Agent, Annotation, Decision, Event, FileOpType, FileOperation, Harness, HarnessClient,
    ShellCommand, ToolCall, TrajectoryEvent, WebFetch,
};
use std::io::{self, Read, Write};
use tokio::io::AsyncBufReadExt;

#[derive(Deserialize)]
struct AdapterRequest {
    trajectory_id: String,
    agent_id: String,
    tool: String,
    action: String,
    args: serde_json::Value,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    event_type: Option<String>,
}

#[derive(Serialize)]
struct AdapterResponse {
    decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    annotations: Vec<AdapterAnnotation>,
}

#[derive(Serialize)]
struct AdapterAnnotation {
    #[serde(skip_serializing_if = "Option::is_none")]
    policy_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty", default)]
    annotations: std::collections::HashMap<String, String>,
}

impl From<&Annotation> for AdapterAnnotation {
    fn from(a: &Annotation) -> Self {
        Self {
            policy_id: a.policy_id.clone(),
            description: a.description.clone(),
            annotations: a.annotations.clone(),
        }
    }
}

fn build_action(req: &AdapterRequest) -> Action {
    match req.action.as_str() {
        "ShellCommand" => Action::ShellCommand(ShellCommand {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            command: req
                .args
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            working_dir: req.cwd.clone(),
        }),
        "FileRead" => Action::FileOperation(FileOperation {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            operation: FileOpType::Read,
            path: req
                .args
                .get("path")
                .or_else(|| req.args.get("filePath"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            content: None,
            old_content: None,
        }),
        "FileWrite" => Action::FileOperation(FileOperation {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            operation: FileOpType::Write,
            path: req
                .args
                .get("path")
                .or_else(|| req.args.get("filePath"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            content: req
                .args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            old_content: None,
        }),
        "FileEdit" => Action::FileOperation(FileOperation {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            operation: FileOpType::Edit,
            path: req
                .args
                .get("path")
                .or_else(|| req.args.get("filePath"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            content: req
                .args
                .get("new_content")
                .or_else(|| req.args.get("newString"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            old_content: req
                .args
                .get("old_content")
                .or_else(|| req.args.get("oldString"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        }),
        "WebFetch" => Action::WebFetch(WebFetch {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            url: req
                .args
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            prompt: String::new(),
        }),
        _ => Action::ToolCall(ToolCall {
            call_id: format!("call-{}", uuid::Uuid::new_v4()),
            tool: req.tool.clone(),
            arguments: req.args.clone(),
        }),
    }
}

async fn do_adjudicate(client: &HarnessClient, req: AdapterRequest) -> Result<AdapterResponse> {
    let agent = Agent {
        id: req.agent_id.clone(),
        provider_id: "opencode".to_string(),
    };
    let event = Event::new(
        agent,
        &req.trajectory_id,
        TrajectoryEvent::Action(build_action(&req)),
    );
    let result = client.adjudicate(event).await?;
    Ok(AdapterResponse {
        decision: match result.decision {
            Decision::Allow => "allow".to_string(),
            Decision::Deny => "deny".to_string(),
            Decision::Escalate => "escalate".to_string(),
        },
        reason: result.reason,
        annotations: result
            .annotations
            .iter()
            .map(AdapterAnnotation::from)
            .collect(),
    })
}

async fn adjudicate(req: AdapterRequest) -> Result<AdapterResponse> {
    let client = HarnessClient::connect_default().await?;
    do_adjudicate(&client, req).await
}

async fn stream_mode() -> Result<()> {
    let stdin = tokio::io::BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();
    let mut harness_client: Option<HarnessClient> = None;
    let mut stdout = io::BufWriter::new(io::stdout());
    let mut shutting_down = false;

    loop {
        let line = tokio::select! {
            line = lines.next_line() => line?,
            _ = tokio::signal::ctrl_c() => {
                if shutting_down {
                    break;
                }
                eprintln!("[sondera] shutting down, waiting for current request...");
                shutting_down = true;
                continue;
            }
        };

        let Some(line) = line else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: AdapterRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                let resp = AdapterResponse {
                    decision: "allow".to_string(),
                    reason: Some(format!("invalid request: {}", e)),
                    annotations: vec![],
                };
                writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                stdout.flush()?;
                continue;
            }
        };

        if harness_client.is_none() {
            match HarnessClient::connect_default().await {
                Ok(c) => harness_client = Some(c),
                Err(e) => {
                    let resp = AdapterResponse {
                        decision: "allow".to_string(),
                        reason: Some(format!("harness unreachable: {}", e)),
                        annotations: vec![],
                    };
                    writeln!(stdout, "{}", serde_json::to_string(&resp)?)?;
                    stdout.flush()?;
                    continue;
                }
            }
        }

        let response = match do_adjudicate(harness_client.as_ref().unwrap(), req).await {
            Ok(r) => r,
            Err(e) => {
                harness_client = None;
                AdapterResponse {
                    decision: "allow".to_string(),
                    reason: Some(format!("adjudication error: {}", e)),
                    annotations: vec![],
                }
            }
        };

        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;

        if shutting_down {
            break;
        }
    }

    Ok(())
}

async fn health_check() -> Result<()> {
    let client = HarnessClient::connect_default().await?;
    let healthy = client.health().await?;
    if healthy {
        println!("{}", serde_json::json!({"status": "ok"}));
        Ok(())
    } else {
        anyhow::bail!("harness health check failed")
    }
}

fn print_usage() {
    eprintln!(
        "sondera-opencode-adapter {}\n\
         \n\
         Usage: sondera-opencode-adapter <command>\n\
         \n\
         Commands:\n\
         \n\
         health       Check if the harness server is reachable\n\
         adjudicate   Read one JSON event from stdin, return adjudication on stdout\n\
         stream       Read NDJSON events from stdin, return NDJSON adjudications\n\
         \n\
         'stream' keeps a persistent connection to the harness server.\n\
         With no command, defaults to 'adjudicate'.\n\
         \n\
         Socket: $SONDERA_SOCKET or ~/.sondera/sondera-harness.sock\n\
         \n\
         Environment:\n\
         \n\
         SONDERA_SOCKET    Path to the harness server Unix socket\n\
         NO_COLOR          Set to disable colored output",
        env!("CARGO_PKG_VERSION")
    );
}

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    match args.get(1).map(|s| s.as_str()) {
        Some("health") => {
            health_check().await?;
        }
        Some("stream") => {
            stream_mode().await?;
        }
        Some("adjudicate") | None => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let req: AdapterRequest = serde_json::from_str(input.trim())?;
            let response = adjudicate(req).await?;
            println!("{}", serde_json::to_string(&response)?);
        }
        Some("--help") | Some("-h") => {
            print_usage();
        }
        Some("--version") | Some("-V") => {
            println!("sondera-opencode-adapter {}", env!("CARGO_PKG_VERSION"));
        }
        Some(cmd) => {
            anyhow::bail!("unknown command: {}. Run with --help for usage.", cmd);
        }
    }

    let _ = io::stdout().flush();
    Ok(())
}
