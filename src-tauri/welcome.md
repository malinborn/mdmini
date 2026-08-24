# Welcome to md-mini — your editor speaks AI

Your agent can jump you to a spot in the document you already have open, push an edit into the live buffer with the change highlighted, and ask you a question with real buttons in the text. It runs the other way too: select a fragment, press **⇧⌘M**, and your agent answers in the thread.

- [Teach your AI to use md-mini](#teach-your-ai-to-use-md-mini) — do this first, nothing works without it
- [What your AI can do](#what-your-ai-can-do)
- [Commenting on the text](#commenting-on-the-text)
- [Good to know](#good-to-know)

Close this window whenever you like — all of it lives permanently in the **AI** menu, starting with **Getting Started**, a fuller version of this page.

## Teach your AI to use md-mini

No agent figures md-mini out on its own. Installing it changes nothing until you hand your agent a block of instructions — and there are two ways to do that, both fine:

1. **Paste the block into its instruction file** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules`, `.github/copilot-instructions.md`. Simplest, and always in effect.
2. **Make a skill of it, and point at the skill from that file.** Hand the block to your agent and ask for exactly that; the instruction file then carries one line instead of the whole block, and the instructions load only when they're relevant.

Where to get the block — the **AI** menu in the menu bar:

- **Connect AI via CLI** — for any agent with a shell. This is the block itself.
- **Connect AI via MCP** — one command for Claude Code, if you'd rather it call md-mini as MCP tools than as a shell command.
- **Teach your AI md-mini** — the companion block for the MCP route: the tools describe themselves, but this is what tells your agent *when* to use them.

Both blocks end with the exact prompt to hand over for the skill route.

## What your AI can do

| | |
|---|---|
| **show** | Jumps you to a line or a piece of text, with a brief pulse highlight. |
| **edit** | Rewrites the live buffer — the changed span stays highlighted until you press **Esc**. |
| **ask** | Puts buttons in the document: single choice, checkboxes, or a free-text field. Blocks until you answer. |
| **question** | Reads the comments you left, so it can answer them. |
| **answer** | Replies in a comment thread and marks it answered. |

## Commenting on the text

Select a fragment, press **⇧⌘M**, type your question. The fragment gets marked, and its card tells you which words it's about.

Your document is never modified — threads live in a plain-markdown file beside it, `.mdmini_comments_<name>.md`. Commit it if you want review threads to travel with the branch, or ignore it. md-mini doesn't decide for you.

For your agent to notice a comment, it has to be watching: **Connect Agent to Doc Questions** copies the prompt that arms it, once per session. Any other agent can be handed one comment at a time with **send to agent** on the card — no setup, no MCP.

## Good to know

- **Esc** hides an AI-edit highlight; **Cmd+Z** undoes an AI edit like any change of your own.
- Questions time out after five minutes by default, and can be dismissed early with ✕.
- Everything is per-window, so several documents can each have their own question waiting.
- **AI Playbook** in the AI menu is the interesting part — what to do with all this, not how to switch it on.

---

Full reference: `mdmini help`, and `docs/ai-interface.md` in the repo.
