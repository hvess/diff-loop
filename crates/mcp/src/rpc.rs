//! MCP over stdio: one JSON-RPC message per line, answering `initialize`,
//! `tools/list`, `tools/call` and `ping`; notifications get no answer.

use std::io::{self, BufRead, Write};

use diff_loop_core::{ReviewKey, ReviewStore};
use serde_json::{Value, json};

use crate::tools::{self, ToolError};

/// The protocol version answered when the client names none.
const PROTOCOL: &str = "2025-06-18";

/// What the server answers with: the store, and which review the agent's
/// folder shows, asked again at each call, since the agent may switch
/// branches between them.
pub(crate) struct Server<'a> {
    pub(crate) store: &'a dyn ReviewStore,
    pub(crate) key: &'a dyn Fn() -> Result<ReviewKey, ToolError>,
}

impl Server<'_> {
    /// Answers each message on `input` on `output` until `input` ends. A
    /// line that is not JSON is answered with a parse error.
    pub(crate) fn serve(&self, input: impl BufRead, mut output: impl Write) -> io::Result<()> {
        for line in input.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let answer = match serde_json::from_str::<Value>(&line) {
                Ok(message) => self.answer(&message),
                Err(e) => Some(failure(&Value::Null, -32700, &e.to_string())),
            };
            if let Some(answer) = answer {
                writeln!(output, "{answer}")?;
                output.flush()?;
            }
        }
        Ok(())
    }

    /// The reply to `message`; `None` for a notification, which has no id.
    fn answer(&self, message: &Value) -> Option<Value> {
        let id = message.get("id")?;
        let params = message.get("params").unwrap_or(&Value::Null);
        let result = match message.get("method").and_then(Value::as_str) {
            Some("initialize") => json!({
                "protocolVersion": params
                    .get("protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or(PROTOCOL),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "diff-loop", "version": env!("CARGO_PKG_VERSION") },
            }),
            Some("ping") => json!({}),
            Some("tools/list") => json!({ "tools": tool_list() }),
            Some("tools/call") => self.call(params),
            _ => return Some(failure(id, -32601, "method not found")),
        };
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    /// A tool's result: its text, or why it failed, marked as an error so
    /// the agent reads it as one.
    fn call(&self, params: &Value) -> Value {
        let arguments = params.get("arguments").unwrap_or(&Value::Null);
        let text = |name: &str| arguments.get(name).and_then(Value::as_str);
        let outcome = (self.key)().and_then(|key| {
            match params.get("name").and_then(Value::as_str).unwrap_or("") {
                "get_review" => tools::get_review(self.store, &key),
                "resolve_comment" => {
                    let id = text("id").ok_or(ToolError::NoId)?;
                    tools::resolve_comment(self.store, &key, id, text("note").unwrap_or(""))
                }
                other => Err(ToolError::NoTool(other.to_owned())),
            }
        });
        match outcome {
            Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
            Err(e) => {
                json!({ "content": [{ "type": "text", "text": e.to_string() }], "isError": true })
            }
        }
    }
}

/// The tools as `tools/list` names them.
fn tool_list() -> Value {
    json!([
        {
            "name": "get_review",
            "description": "The open review comments, questions and suggestions the developer left in \
                Diff Loop on the branch checked out here, each with its file, lines and id, and the review \
                file they are kept in.",
            "inputSchema": { "type": "object", "properties": {} },
        },
        {
            "name": "resolve_comment",
            "description": "Marks a review comment you dealt with as resolved, with a one-line note: what \
                you changed, or for a question, your answer. The comment stays in the review, so the \
                developer can see what was asked.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The comment's id, as get_review gives it." },
                    "note": { "type": "string", "description": "What you changed, or your answer, in one line." },
                },
                "required": ["id", "note"],
            },
        },
    ])
}

/// A JSON-RPC error reply.
fn failure(id: &Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use diff_loop_core::{AnchorState, Comment, SavedReview, Target};

    use super::*;
    use crate::memory::Memory;

    /// What the server answers to `lines`, one reply per line.
    fn exchange(server: &Server<'_>, lines: &[Value]) -> Vec<Value> {
        let input: String = lines.iter().map(|l| format!("{l}\n")).collect();
        let mut output = Vec::new();
        server.serve(input.as_bytes(), &mut output).unwrap();
        String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn a_session_lists_the_tools_reads_the_review_and_resolves_a_comment() {
        let key = ReviewKey {
            project: "/p/.git".into(),
            branch: "b".into(),
        };
        let store = Memory::default();
        let comment = Comment {
            id: "c1".into(),
            path: "a.rs".into(),
            target: Target::File,
            text: "Name it.".into(),
            suggestion: None,
            state: AnchorState::Current,
            place: None,
            sent: None,
            resolved: None,
            note: None,
            question: false,
        };
        let review = SavedReview {
            comments: vec![comment],
            ..SavedReview::default()
        };
        store.save(&key, &review).unwrap();
        let locate = || Ok(key.clone());
        let server = Server {
            store: &store,
            key: &locate,
        };
        let replies = exchange(
            &server,
            &[
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }),
                json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
                json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
                json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "get_review", "arguments": {} } }),
                json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "resolve_comment", "arguments": { "id": "c1", "note": "Named it." } } }),
                json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "resolve_comment", "arguments": { "id": "c1", "note": "Again." } } }),
                json!({ "jsonrpc": "2.0", "id": 6, "method": "nothing" }),
            ],
        );
        assert_eq!(replies.len(), 6, "a notification gets no reply");
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(replies[1]["result"]["tools"][1]["name"], "resolve_comment");
        let review = replies[2]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(review.contains("(id `c1`)"), "{review}");
        assert_eq!(replies[3]["result"].get("isError"), None);
        assert_eq!(replies[4]["result"]["isError"], true);
        assert_eq!(replies[5]["error"]["code"], -32601);
        assert_eq!(
            store.saved(&key).unwrap().comments[0].note.as_deref(),
            Some("Named it.")
        );
    }

    #[test]
    fn a_line_that_is_not_json_is_a_parse_error() {
        let store = Memory::default();
        let locate = || Err(ToolError::Detached);
        let server = Server {
            store: &store,
            key: &locate,
        };
        let mut output = Vec::new();
        server.serve("not json\n".as_bytes(), &mut output).unwrap();
        let reply: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(reply["error"]["code"], -32700);
    }
}
