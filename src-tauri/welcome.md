# Welcome to md-mini 1.0 — your editor now speaks AI

md-mini can now be driven by AI agents (Claude Code and others): they can point at places in your open documents, edit them with visible highlights, and ask you questions with buttons right in the document.

## Hook it up — option 1: CLI (zero config)

Run `mdmini agent` and paste the printed block into your agent's instruction file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `copilot-instructions.md`). Agents with shell access can then use `mdmini show` / `edit` / `ask` directly.

## Hook it up — option 2: MCP

```bash
claude mcp add --scope user mdmini -- mdmini mcp
```

For other MCP clients, add this to your `mcpServers` config:

```json
{
  "mcpServers": {
    "mdmini": {
      "command": "mdmini",
      "args": ["mcp"]
    }
  }
}
```

The tools are self-describing, so no instruction-file snippet is required — but behavior guidance still helps. Run `mdmini agent --mcp` and paste its output into your agent's instructions for noticeably better AI behavior.

## What your AI can do now

| Command | What it does |
|---------|--------------|
| `show` | Jumps you to a line or a piece of text, with a brief pulse highlight. |
| `edit` | Rewrites the live buffer — the changed span shimmers until you press Esc. |
| `ask` | Puts buttons in the document: single choice, `--multi` checkboxes, or `--free-text` for your own answer. Blocks until you respond. |

## Good to know

- **Esc** hides the AI-edit highlight — a hint appears the first time.
- **Cmd+Z** undoes an AI edit, like any other change.
- Questions time out after 5 minutes by default, and can be dismissed early with ✕.
- Everything works per-window — multiple questions can coexist across your open documents.

---

Full reference: `mdmini help`, and `docs/ai-interface.md` in the repo.
