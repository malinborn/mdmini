# Welcome to md-mini 1.0 — your editor now speaks AI

md-mini can now be driven by AI agents (Claude Code and others): they can point at places in your open documents, edit them with visible highlights, and ask you questions with buttons right in the document.

And it runs both ways: **you can comment on a fragment and your agent answers in the thread** — in the session it is already working in, with all of its context. Select some text, press **⇧⌘M**, ask.

## Where this lives

Close this window whenever you like — all of it is permanently in the **AI** menu, in the menu bar:

```
AI
├── Getting Started               ← the short version of this document
├── Connect AI via CLI            ← snippet to paste into CLAUDE.md / AGENTS.md
├── Connect AI via MCP            ← one command for Claude Code
├── Teach your AI md-mini         ← how your agent should use it well
├── Comment on Selection          ← ⇧⌘M — ask your agent about a fragment
├── Connect Agent to Doc Questions ← copies the prompt that starts it watching
└── AI Playbook                   ← what to actually do with it
```

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
| `question` | Reads the comments you left, so it can answer them. |
| `answer` | Replies in a comment thread and marks it answered. |

## Comments: asking your AI about the text

Select a fragment, press **⇧⌘M**, type your question. The fragment gets marked, and the card tells you which words it is about — put the caret in a commented fragment and its card lights up, click into a card and its fragment lights up back.

Your document is never modified. Threads live in a plain-markdown file beside it, `.mdmini_comments_<name>.md` — commit it if you want review threads to travel with the branch, or ignore it. md-mini does not decide for you.

**This works best with Claude Code**, which can be woken the moment you comment: **Connect Agent to Doc Questions** copies the prompt that arms it, once per session. Any other agent can still be handed one comment at a time with **send to agent** on the card — that path needs no setup and no MCP, because the comment file is readable markdown.

## Good to know

- **Esc** hides the AI-edit highlight — a hint appears the first time.
- **Cmd+Z** undoes an AI edit, like any other change.
- Questions time out after 5 minutes by default, and can be dismissed early with ✕.
- Everything works per-window — multiple questions can coexist across your open documents.

---

Full reference: `mdmini help`, and `docs/ai-interface.md` in the repo.
