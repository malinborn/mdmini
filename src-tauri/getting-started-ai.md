# Getting Started with AI in md-mini

md-mini can be driven by an AI agent. Instead of writing a file to disk and hoping you notice, your agent points at a spot in the document you already have open, pushes an edit into the live buffer with the change highlighted, and asks you questions with real buttons right there in the text.

## Where this lives

Everything about this is in the **AI** menu, in the menu bar. Nothing here is one-time — come back to it whenever you need it:

```
AI
├── Getting Started        ← this document
├── Connect AI via CLI     ← snippet to paste into CLAUDE.md / AGENTS.md
├── Connect AI via MCP     ← one command for Claude Code
├── Teach your AI md-mini  ← how your agent should use it well
└── AI Playbook            ← what to actually do with it
```

You never have to remember a command. You only have to remember the menu.

## Connect in a minute

Pick whichever matches your agent. Both end up at the same place.

### Claude Code — one command

```bash
claude mcp add --scope user mdmini -- mdmini mcp
```

That's the whole setup. The tools describe themselves, so no instruction-file snippet is required.

### Any agent with a shell

```bash
mdmini agent
```

Paste what it prints into your agent's instruction file — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.github/copilot-instructions.md`.

## Check that it worked

Ask your agent, in its own chat:

> Open this file in mdmini and highlight the first heading.

A window should come to the front with the heading pulsing. If nothing happens, **Connect AI via CLI** and **Connect AI via MCP** in the AI menu have the exact snippets again.

## What your agent can do

| | |
|---|---|
| **show** | Jumps you to a line or a piece of text, with a brief pulse highlight. |
| **edit** | Rewrites the live buffer — the changed span stays highlighted until you dismiss it. |
| **ask** | Puts buttons in the document: single choice, checkboxes, or a free-text field. Blocks until you answer. |

## Good to know

- **Esc** hides an AI-edit highlight.
- **Cmd+Z** undoes an AI edit exactly like any change of your own — nothing is final until you move on.
- Questions time out after five minutes by default, and you can dismiss one early with ✕.
- Everything is per-window, so several documents can each have their own question waiting.

Once it's connected, **AI Playbook** in the AI menu is the interesting part — it's about what to do with this, not how to switch it on.
