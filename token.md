token 统计

opencode 的 opencode.db 数据库文件，session 表记录了每个会话使用到的token用量，包含 input output cahe_read cache_write

cline 的 json 文件里面包含 token 的使用情况

workbuddy 中的 workbuddy.db 文件，session_usage 表记录了每个会话使用到的token用量，但是只有总的

zcode 的 C:\Users\Administrator\.zcode\cli\db\db.sqlite 的 model_usage 表记录了每个会话的用量

claude 的会话 JSONL（~/.claude/projects/<slug>/<sessionId>.jsonl）中，assistant 行的 message.usage 记录每次 API 调用用量（input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens/output_tokens_details.thinking_tokens），无成本字段。注意：同一条 API 消息会拆成多行 JSONL（message.id 相同、usage 相同），统计前必须按 message.id 去重再累加。

