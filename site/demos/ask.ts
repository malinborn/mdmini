import { ChangeSet } from '@codemirror/state';
import { computeReplacement, type Replacement } from '@app/lib/editor/content-diff';
import { clearAiHighlights, setAiHighlights } from '@app/lib/editor/ai-highlight';
import { activeAskIds, addAiAsk, removeAiAsk, type AskSpec } from '@app/lib/editor/ai-ask';
import { mountDemoEditor, prefersReducedMotion } from './editor-demo';

type AskResult = Parameters<AskSpec['onAnswer']>[1];

const ENV_PLACEHOLDER = '_not yet specified_';

// Short labels on purpose: this is the option text a real `cm-ai-ask-option`
// chip renders, and the multi-select row (three chips + the widget's own OK
// button) has to fit on one line at the card's ~380px width — see mount()
// below for why only one ask card is ever on screen at a time.
const SECTION_ORDER = ['Deploy', 'Rollback', 'On-call'] as const;
type Section = (typeof SECTION_ORDER)[number];

const ENV_OPTIONS = ['Staging', 'Production', 'Both'] as const;
type EnvChoice = (typeof ENV_OPTIONS)[number];
const ENV_QUESTION = 'Which environment should this runbook target?';
const SECTIONS_QUESTION = 'Keep which sections?';

/** The two answers, normalized: which sections the visitor picked from the
 * fixed chip list, plus whatever they typed in the free-text field (trimmed,
 * `''` when they didn't use it). Kept as one object rather than two loose
 * variables because both drive the *same* generated body below — a custom
 * section is just another block appended after the fixed ones. */
interface SectionsState {
  picked: Section[];
  custom: string;
}

const DEFAULT_SECTIONS: SectionsState = { picked: [...SECTION_ORDER], custom: '' };

/** The auto-loop's own deterministic answers — always the same pick, since
 * the point is to demonstrate the round trip, not to seem random. Reused
 * below as the reduced-motion "already answered" exemplar too, so a visitor
 * who never sees the animation still sees the same concrete story. */
const AUTO_ENV_CHOICE: EnvChoice = 'Production';
const AUTO_TICKED_SECTIONS: readonly Section[] = ['Deploy', 'Rollback'];

/**
 * Per-section, per-environment copy. This is the whole point of the
 * rewrite: a Production rollback reads differently from a Staging one
 * (approval gate, urgency, who gets paged) — it isn't the same sentence with
 * one word swapped in. Each entry is one sentence, kept short on purpose:
 * the generated body types in on screen and has to stay inside the card's
 * fixed height (see the "scroll instead of grow" comment on mount() below),
 * and up to three of these plus a custom block can appear in one document.
 */
const SECTION_CONTENT: Record<Section, Record<EnvChoice, string>> = {
  Deploy: {
    Staging: 'Push straight to staging on every merge — no approval needed, canary optional.',
    Production:
      'Ship only after a peer-reviewed PR and a green canary; announce the deploy window in #incidents.',
    Both: 'Land on staging automatically on merge; promote that exact build to production only after review and a green canary.',
  },
  Rollback: {
    Staging: 'Roll back staging any time, no approval needed — just note it in #deploys.',
    Production:
      'Roll back immediately on failure; skip the approval queue and page on-call if the redeploy itself fails.',
    Both: 'Staging rollbacks are self-serve; a production rollback needs on-call sign-off before it starts.',
  },
  'On-call': {
    Staging: 'Ping #eng-oncall if staging misbehaves — daytime only, no page.',
    Production: 'Page the on-call engineer immediately; every production rollback counts as an incident.',
    Both: 'Page on-call for anything touching production; a Slack ping covers staging on its own.',
  },
};

/** True for the three fixed chip labels, false for a custom typed answer. */
function isSection(value: string): value is Section {
  return (SECTION_ORDER as readonly string[]).includes(value);
}

/** Narrows a possibly-stale/placeholder env string back to a real choice,
 * falling back to the auto-loop's own pick — used only as a defensive floor;
 * `generateBody` is never called before `env` has actually been answered. */
function envChoiceOf(env: string): EnvChoice {
  return (ENV_OPTIONS as readonly string[]).includes(env) ? (env as EnvChoice) : AUTO_ENV_CHOICE;
}

/** The `**Keep in this runbook:**` summary line — lists the fixed sections
 * by name plus the custom one in quotes, so a visitor can see at a glance
 * that their own typed answer became part of the plan, not just the body
 * below it. */
function summarizeKept(sections: SectionsState): string {
  if (sections.picked.length === SECTION_ORDER.length && !sections.custom) return 'everything';
  const items: string[] = [...sections.picked];
  if (sections.custom) items.push(`"${sections.custom}"`);
  return items.length > 0 ? items.join(', ') : '_none yet_';
}

/** One line of guidance for a section nobody wrote a template for — still
 * shaped by the chosen environment, so even the free-text path visibly
 * carries the env answer, not just its own name. */
function customSectionCopy(name: string, env: EnvChoice): string {
  const rule =
    env === 'Production'
      ? 'the same peer-reviewed approval and on-call page as the rest of this runbook'
      : env === 'Staging'
        ? 'the same no-approval, self-serve pace as the rest of this runbook'
        : 'the same staging-first, approval-gated promotion as the rest of this runbook';
  return `No preset steps for "${name}" yet — until someone writes them, follow ${rule}.`;
}

/** The generated runbook body: one `## Section` block per chosen fixed
 * section (in a stable order, not answer order) plus one more for a typed
 * custom answer, each carrying environment-specific wording. Only what was
 * actually picked appears — nothing is a placeholder. */
function generateBody(env: string, sections: SectionsState): string {
  const choice = envChoiceOf(env);
  const blocks: string[] = [];
  for (const section of SECTION_ORDER) {
    if (sections.picked.includes(section)) blocks.push(`## ${section}\n${SECTION_CONTENT[section][choice]}`);
  }
  if (sections.custom) blocks.push(`## ${sections.custom}\n${customSectionCopy(sections.custom, choice)}`);
  return blocks.length > 0 ? blocks.join('\n\n') : '_Nothing selected — nothing to write._';
}

/** Builds the full runbook doc from both answers so far; always ends in the
 * blank line mountDemoEditor parks the selection on.
 *
 * Two states, not a gradient:
 * - Either answer still outstanding (`sectionsAnswered` false, or `env`
 *   still the placeholder): just the two metadata lines, exactly like the
 *   original substitution-only version of this demo — there's nothing to
 *   generate yet because the agent doesn't have both inputs.
 * - Both answered: the same two metadata lines, followed by the generated
 *   body. This is the payoff the owner asked for — content that names the
 *   chosen environment and only the chosen sections, typed in by the caller
 *   (see revealGeneratedBody below) rather than substituted in place.
 */
function buildDoc(env: string, sections: SectionsState, sectionsAnswered: boolean): string {
  const header = `# Rollback runbook\n**Environment:** ${env}\n**Keep in this runbook:** ${summarizeKept(sections)}`;
  const envAnswered = env !== ENV_PLACEHOLDER;
  const full = envAnswered && sectionsAnswered ? `${header}\n\n${generateBody(env, sections)}` : header;
  return full.endsWith('\n\n') ? full : `${full}\n\n`;
}

/** Normalizes every `AskSpec.onAnswer` result shape to a chosen-options list plus free text. */
function parseAnswer(result: AskResult): { chosen: string[]; custom: string } | null {
  if (result === null) return null;
  if (typeof result === 'string') return { chosen: [result], custom: '' };
  if (Array.isArray(result)) return { chosen: result, custom: '' };
  if ('answers' in result) return { chosen: result.answers, custom: result.custom };
  return { chosen: [], custom: result.custom };
}

const DISMISS_RESTORE_MS = 4000;
const RESET_AFTER_MS = 20000;

/** Watches for `el` leaving the document and runs `onRemoved` once, then stops watching. */
function watchRemoval(el: HTMLElement, onRemoved: () => void): void {
  const observer = new MutationObserver(() => {
    if (el.isConnected) return;
    observer.disconnect();
    onRemoved();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---- Auto-loop pacing (see the long comment on runPilotCard1/2 below for
// why these are split into a "flow" tier — always runs, human or script —
// and a "pilot" tier — only runs while nobody's driving). ----

/** How long a freshly-arrived question sits before anything starts moving —
 * long enough to actually read a short question. */
const READ_BEAT_MS = 1400;
/** How long the "about to click" pressed look holds on the target chip
 * before the real click fires — long enough to register as a deliberate,
 * visible click rather than a flicker. */
const PRECLICK_MS = 550;
/** Fade-and-lift while a card leaves, between the real click landing and the
 * widget actually being removed — gives the click a beat to register before
 * the card is simply gone. Matches demo-ask.css's demo-ask-exit duration. */
const EXIT_MS = 220;
/** Gap between a card leaving (doc updated + highlighted) and the next
 * question arriving. */
const AFTER_ANSWER_MS = 900;
/** Gap between the first and second chip tick in the multi-select card. */
const TICK_GAP_MS = 500;
/** Beat after the last tick before OK gets its own visible press. */
const BEFORE_CONFIRM_MS = 700;
/** Milliseconds per character while the generated runbook body types in —
 * see revealGeneratedBody. Faster than edit.ts's own typing pace (22ms):
 * this body is several sentences, not one paragraph, and the point is to
 * read as "being produced", not to be read word-by-word in real time. */
const TYPE_GEN_MS = 11;
/** Automated-loop pause on the fully-answered doc before everything resets.
 * Short: nobody has to read it, this is the "look at me" showcase pace. */
const RESET_GAP_MS = 2200;
/** How long a real visitor must be idle before the auto-loop resumes. */
const IDLE_RESUME_MS = 6000;

const PRECOMMIT_CLASS = 'demo-ask-precommit';
const EXIT_CLASS = 'demo-ask-exit';

export function mount(container: HTMLElement): void {
  let envLabel = ENV_PLACEHOLDER;
  let sectionsState: SectionsState = { ...DEFAULT_SECTIONS };
  let sectionsAnswered = false;
  let nextId = 1;

  const { view, destroy } = mountDemoEditor(container, {
    doc: buildDoc(envLabel, sectionsState, sectionsAnswered),
    height: 449,
  });

  function applyDoc(newDoc: string, highlight: boolean): void {
    const repl = computeReplacement(view.state.doc.toString(), newDoc);
    if (!repl) return;
    view.dispatch({
      changes: ChangeSet.of(repl, view.state.doc.length),
      effects: highlight
        ? [setAiHighlights.of([{ from: repl.from, to: repl.from + repl.insert.length }])]
        : [clearAiHighlights.of(null)],
    });
  }

  // ---- Reduced motion: no typing, no auto-loop. The card opens already in
  // the "both questions answered" end state — the auto-loop's own exemplar
  // (Production, Deploy + Rollback) — with the generated body under the
  // same persistent highlight a real answer would leave. Both ask cards
  // still mount on top of it, unanswered, so a visitor can pick different
  // answers by hand and immediately see a different generated body (still
  // one instant `applyDoc`, never typed — that's the reduced-motion
  // contract). A dismiss/answer restores/resets back to that same exemplar,
  // never to the blank placeholder form: unlike the animated loop, there is
  // no cold-open "before either question is answered" moment to replay
  // here. ----
  if (prefersReducedMotion()) {
    // Typed as `number`, not `ReturnType<typeof setTimeout>`: with
    // @types/node in the program (for site/__tests__), `window` merges
    // DOM's `setTimeout` (returns `number`) with Node's global overload
    // into one overloaded signature, and a bare `ReturnType<>` query picks
    // Node's last overload even though this only ever runs in a browser.
    let resetTimer: number | undefined;
    let restoreCard1Timer: number | undefined;
    let restoreCard2Timer: number | undefined;

    function addCard1Static(): void {
      const doc = view.state.doc.toString();
      const idx = doc.indexOf('**Environment:**');
      const spec: AskSpec = {
        id: nextId++,
        question: ENV_QUESTION,
        options: [...ENV_OPTIONS],
        multi: false,
        freeText: false,
        onAnswer: onAnswerEnvStatic,
      };
      view.dispatch({ effects: addAiAsk.of({ spec, pos: idx === -1 ? 0 : idx }) });
    }

    function addCard2Static(): void {
      const doc = view.state.doc.toString();
      const idx = doc.indexOf('**Keep in this runbook:**');
      const pos = idx === -1 ? doc.length : idx;
      const spec: AskSpec = {
        id: nextId++,
        question: SECTIONS_QUESTION,
        options: [...SECTION_ORDER],
        multi: true,
        freeText: true,
        onAnswer: onAnswerSectionsStatic,
      };
      view.dispatch({ effects: addAiAsk.of({ spec, pos }) });
    }

    function scheduleReset(): void {
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(resetAll, RESET_AFTER_MS);
    }

    function resetAll(): void {
      envLabel = AUTO_ENV_CHOICE;
      sectionsState = { picked: [...AUTO_TICKED_SECTIONS], custom: '' };
      applyDoc(buildDoc(envLabel, sectionsState, true), false);
      addCard1Static();
      addCard2Static();
    }

    function onAnswerEnvStatic(id: number, result: AskResult): void {
      view.dispatch({ effects: removeAiAsk.of(id) });
      const parsed = parseAnswer(result);
      if (!parsed) {
        restoreCard1Timer = window.setTimeout(addCard1Static, DISMISS_RESTORE_MS);
        return;
      }
      envLabel = parsed.custom || parsed.chosen[0] || envLabel;
      applyDoc(buildDoc(envLabel, sectionsState, true), true);
      scheduleReset();
    }

    function onAnswerSectionsStatic(id: number, result: AskResult): void {
      view.dispatch({ effects: removeAiAsk.of(id) });
      const parsed = parseAnswer(result);
      if (!parsed) {
        restoreCard2Timer = window.setTimeout(addCard2Static, DISMISS_RESTORE_MS);
        return;
      }
      sectionsState = { picked: parsed.chosen.filter(isSection), custom: parsed.custom };
      applyDoc(buildDoc(envLabel, sectionsState, true), true);
      scheduleReset();
    }

    // Cold open = the exemplar's end state, not the blank placeholder form —
    // see the block comment above. `applyDoc` here runs the real diff off
    // the doc `mountDemoEditor` was constructed with (the fully-blank form
    // built above), so the highlight is genuine, not asserted.
    envLabel = AUTO_ENV_CHOICE;
    sectionsState = { picked: [...AUTO_TICKED_SECTIONS], custom: '' };
    applyDoc(buildDoc(envLabel, sectionsState, true), true);
    addCard1Static();
    addCard2Static();

    watchRemoval(container, () => {
      if (resetTimer) window.clearTimeout(resetTimer);
      if (restoreCard1Timer) window.clearTimeout(restoreCard1Timer);
      if (restoreCard2Timer) window.clearTimeout(restoreCard2Timer);
      destroy();
    });
    return;
  }

  // ---- Animated auto-loop ----
  //
  // Two tiers, deliberately kept separate:
  //
  // - "flow": what happens after a card is answered — remove the widget,
  //   apply the doc edit, and (after a beat) show the next question or
  //   reset. This runs identically no matter who answered — script or a
  //   real visitor — because the round trip through a real onAnswer is the
  //   whole point of the demo either way. Once *both* answers are in, flow
  //   also covers the generated-body reveal (revealGeneratedBody) — typing
  //   the real content in and leaving it under a real highlight, again
  //   regardless of who supplied the answers.
  // - "pilot": the auto-loop's own scripted button presses, layered on top.
  //   It only ever runs while `canAutoRun()` holds, and any interruption
  //   (a real visitor's pointer/click/keypress, the slide going off-screen,
  //   the tab going hidden) invalidates it immediately mid-flight — a
  //   pending "about to click" visual is stripped the instant that happens
  //   so nothing is left looking stuck.
  //
  // Only one card is ever on screen at a time by construction (card 2 is
  // only added from inside card 1's own answered-callback, after card 1's
  // widget has already been removed), so the "card fits the fixed height"
  // constraint only has to hold per-card while a card is showing. The
  // generated body that appears once both are answered is a different
  // story — see the scrolling comment on revealGeneratedBody below.

  let flowTimer: number | undefined;
  let pilotGen = 0;
  /** Bumped by hardReset so a generation loop from a *previous* cycle can
   * never keep typing into a document that has since reset back to blank —
   * see revealGeneratedBody/typeGenerated. Separate from pilotGen: going
   * off-screen or losing focus should pause an in-flight generation (via
   * runnableStage below), not throw it away, since it isn't a "pilot"
   * scripted press. */
  let genGen = 0;
  let precommitEl: HTMLButtonElement | null = null;
  let onScreen = true; // corrected by the IntersectionObserver below on the next frame
  let userOverride = false;
  let idleResumeTimer: number | undefined;
  let lastAllowed = false; // tracked by reconcile() to detect canAutoRun() edges
  let alive = true;

  function canAutoRun(): boolean {
    return onScreen && !document.hidden && !userOverride;
  }

  /** Gate for the generation typing loop only: pauses (not cancels) while
   * off-screen or the tab is hidden, same signal `canAutoRun` uses minus the
   * `userOverride` check — a real visitor's own click is what *started* the
   * generation, so their continued presence shouldn't pause it. */
  function runnableStage(): boolean {
    return onScreen && !document.hidden;
  }

  let runnableResolvers: Array<() => void> = [];
  function flushRunnableWaiters(): void {
    const waiters = runnableResolvers;
    runnableResolvers = [];
    waiters.forEach((resolve) => resolve());
  }
  function waitUntilRunnableStage(): Promise<void> {
    if (!alive || runnableStage()) return Promise.resolve();
    return new Promise((resolve) => runnableResolvers.push(resolve));
  }
  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  /** Waits out one pacing beat for the generation loop, gated on being
   * on-screen and foregrounded. Returns false if torn down meanwhile. */
  async function genBeat(ms: number): Promise<boolean> {
    await waitUntilRunnableStage();
    if (!alive) return false;
    await sleep(ms);
    return alive;
  }

  function invalidatePilot(): void {
    pilotGen += 1;
    if (precommitEl) {
      precommitEl.classList.remove(PRECOMMIT_CLASS);
      precommitEl = null;
    }
  }

  function pilotWait(ms: number): Promise<void> {
    const gen = pilotGen;
    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (gen === pilotGen) resolve();
        // else: never resolves — the awaiting pilot function simply stops
        // here for good, which is exactly "cancelled".
      }, ms);
    });
  }

  /** Holds the "about to click" look on `btn` for PRECLICK_MS, then fires a
   * real `.click()` so the widget's own onAnswer path runs. Returns false if
   * invalidated mid-hold (the caller should stop, not press on). */
  async function scriptedPress(btn: HTMLButtonElement, gen: number): Promise<boolean> {
    precommitEl = btn;
    btn.classList.add(PRECOMMIT_CLASS);
    await pilotWait(PRECLICK_MS);
    if (gen !== pilotGen) return false;
    precommitEl = null;
    btn.classList.remove(PRECOMMIT_CLASS);
    btn.click();
    return true;
  }

  function findCardEl(question: string): HTMLElement | null {
    for (const card of container.querySelectorAll<HTMLElement>('.cm-ai-ask')) {
      if (card.querySelector('.cm-ai-ask-question')?.textContent?.startsWith(question)) return card;
    }
    return null;
  }

  function findOptionButton(question: string, label: string): HTMLButtonElement | null {
    const card = findCardEl(question);
    if (!card) return null;
    for (const opt of card.querySelectorAll<HTMLButtonElement>('.cm-ai-ask-option')) {
      if (opt.textContent === label) return opt;
    }
    return null;
  }

  function findConfirmButton(question: string): HTMLButtonElement | null {
    return findCardEl(question)?.querySelector<HTMLButtonElement>('.cm-ai-ask-confirm') ?? null;
  }

  /** Single-choice card: read beat, then one visible press on the fixed
   * auto-choice option. */
  async function runPilotCard1(): Promise<void> {
    const gen = pilotGen;
    await pilotWait(READ_BEAT_MS);
    if (gen !== pilotGen) return;
    const btn = findOptionButton(ENV_QUESTION, AUTO_ENV_CHOICE);
    if (!btn) return;
    await scriptedPress(btn, gen);
  }

  /** Multi-choice card: read beat, tick each auto-ticked chip (its own
   * visible press each, with a gap between them), a further beat, then a
   * visible press on OK. */
  async function runPilotCard2(): Promise<void> {
    const gen = pilotGen;
    await pilotWait(READ_BEAT_MS);
    if (gen !== pilotGen) return;

    for (let i = 0; i < AUTO_TICKED_SECTIONS.length; i++) {
      const chip = findOptionButton(SECTIONS_QUESTION, AUTO_TICKED_SECTIONS[i]);
      if (!chip) return;
      if (!(await scriptedPress(chip, gen))) return;
      if (i < AUTO_TICKED_SECTIONS.length - 1) {
        await pilotWait(TICK_GAP_MS);
        if (gen !== pilotGen) return;
      }
    }

    await pilotWait(BEFORE_CONFIRM_MS);
    if (gen !== pilotGen) return;
    const confirmBtn = findConfirmButton(SECTIONS_QUESTION);
    if (!confirmBtn) return;
    await scriptedPress(confirmBtn, gen);
  }

  /** Fades `question`'s card out, then runs `after` (which does the real
   * removeAiAsk + doc edit) once the fade has had time to register. Reused
   * for both scripted and real-visitor answers — the beat between "click
   * landed" and "card gone" isn't a scripted-only affectation. */
  function playExit(question: string, after: () => void): void {
    const wrap = findCardEl(question)?.closest<HTMLElement>('.cm-ai-ask-wrap');
    if (!wrap) {
      after();
      return;
    }
    wrap.classList.add(EXIT_CLASS);
    window.setTimeout(after, EXIT_MS);
  }

  function scheduleFlow(ms: number, fn: () => void): void {
    if (flowTimer) window.clearTimeout(flowTimer);
    flowTimer = window.setTimeout(() => {
      flowTimer = undefined;
      fn();
    }, ms);
  }

  function addCard1(): void {
    const doc = view.state.doc.toString();
    const idx = doc.indexOf('**Environment:**');
    const spec: AskSpec = {
      id: nextId++,
      question: ENV_QUESTION,
      options: [...ENV_OPTIONS],
      multi: false,
      freeText: false,
      onAnswer: onAnswerEnv,
    };
    view.dispatch({ effects: addAiAsk.of({ spec, pos: idx === -1 ? 0 : idx }) });
    if (canAutoRun()) void runPilotCard1();
    extendIdleWindowIfOverridden();
  }

  function addCard2(): void {
    const doc = view.state.doc.toString();
    // Anchored to the start of its own line, exactly like addCard1 above —
    // a block widget placed at doc.length (the very end) would land *after*
    // the generated body once one exists, which is wrong for a still-open
    // question regardless of the vertical-space cost.
    const idx = doc.indexOf('**Keep in this runbook:**');
    const pos = idx === -1 ? doc.length : idx;
    const spec: AskSpec = {
      id: nextId++,
      question: SECTIONS_QUESTION,
      options: [...SECTION_ORDER],
      multi: true,
      freeText: true,
      onAnswer: onAnswerSections,
    };
    view.dispatch({ effects: addAiAsk.of({ spec, pos }) });
    if (canAutoRun()) void runPilotCard2();
    extendIdleWindowIfOverridden();
  }

  function onAnswerEnv(id: number, result: AskResult): void {
    const parsed = parseAnswer(result);
    if (!parsed) {
      view.dispatch({ effects: removeAiAsk.of(id) });
      scheduleFlow(DISMISS_RESTORE_MS, addCard1);
      return;
    }
    const wasOverridden = userOverride;
    playExit(ENV_QUESTION, () => {
      view.dispatch({ effects: removeAiAsk.of(id) });
      envLabel = parsed.custom || parsed.chosen[0] || envLabel;
      applyDoc(buildDoc(envLabel, sectionsState, sectionsAnswered), true);
      // A real visitor gets a touch longer before the next question lands,
      // matching the pacing they'd have gotten from the pre-loop demo.
      scheduleFlow(wasOverridden ? DISMISS_RESTORE_MS : AFTER_ANSWER_MS, addCard2);
    });
  }

  /**
   * Types `repl`'s inserted text in one character at a time at its real
   * position (mirroring edit.ts's own typeEdit), then leaves the whole
   * inserted span under a genuine `setAiHighlights` mark. `gen` is the
   * `genGen` value captured by the caller before this started; if a
   * `hardReset` bumps `genGen` mid-flight (the auto-loop resuming from an
   * idle visitor can fire one while this is still typing — see the comment
   * on `genGen` above), every remaining step becomes a no-op instead of
   * typing into a document this loop no longer has any business touching.
   *
   * Scrolls the card's own scroller to follow the newest character with
   * direct `scrollDOM.scrollTop` writes — never `EditorView.scrollIntoView`,
   * which point.ts (see its `lineTop` comment) found cascades up through
   * every scrollable ancestor to `window.scrollBy` and drags the *page*
   * out from under the visitor. A multi-section generated body is routinely
   * taller than this card's fixed 449px, so tailing the bottom like a log
   * is how the newest line stays visible without the card growing (which
   * would itself retrigger the showcase-ribbon hover-pause bug documented
   * on `.demo-body` in landing.css) and without ever touching page scroll.
   */
  async function typeGenerated(repl: Replacement, gen: number): Promise<boolean> {
    if (gen !== genGen || !alive) return false;
    const { from, to, insert } = repl;
    view.dispatch({ changes: { from, to, insert: '' } });
    let pos = from;
    for (const ch of insert) {
      view.dispatch({ changes: { from: pos, to: pos, insert: ch } });
      pos += ch.length;
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      if (!(await genBeat(TYPE_GEN_MS))) return false;
      if (gen !== genGen) return false;
    }
    view.dispatch({ effects: setAiHighlights.of([{ from, to: from + insert.length }]) });
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    return true;
  }

  /** Runs once both answers are in: diffs the current (env-only) doc against
   * the fully generated one — a single span covering the updated "Keep"
   * line plus every generated section, since that's genuinely one
   * contiguous change — types it in, and only then schedules the reset.
   * Never invoked with only one answer in hand; `sectionsAnswered` is set
   * true by the caller just before this runs. */
  async function revealGeneratedBody(wasOverridden: boolean): Promise<void> {
    const gen = genGen;
    const finalDoc = buildDoc(envLabel, sectionsState, sectionsAnswered);
    const repl = computeReplacement(view.state.doc.toString(), finalDoc);
    const completed = repl ? await typeGenerated(repl, gen) : true;
    if (!completed || gen !== genGen || !alive) return;
    // Same trade-off as onAnswerEnv above: a real visitor's answer earns
    // the original, much longer read-then-reset window; the auto-loop
    // resets quickly because nobody's actually reading it.
    scheduleFlow(wasOverridden ? RESET_AFTER_MS : RESET_GAP_MS, hardReset);
  }

  function onAnswerSections(id: number, result: AskResult): void {
    const parsed = parseAnswer(result);
    if (!parsed) {
      view.dispatch({ effects: removeAiAsk.of(id) });
      scheduleFlow(DISMISS_RESTORE_MS, addCard2);
      return;
    }
    const wasOverridden = userOverride;
    playExit(SECTIONS_QUESTION, () => {
      view.dispatch({ effects: removeAiAsk.of(id) });
      sectionsState = { picked: parsed.chosen.filter(isSection), custom: parsed.custom };
      sectionsAnswered = true;
      void revealGeneratedBody(wasOverridden);
    });
  }

  /** Cancels anything in flight, clears the doc back to defaults, drops any
   * ask widget still present, and starts card 1 fresh. Used both for the
   * end of a completed cycle and to resume after the loop was paused
   * (off-screen, hidden tab, or a visitor who has now gone idle) — treating
   * "resume" as "restart from question one" keeps this simple and matches
   * the natural end-of-cycle reset already asked for. */
  function hardReset(): void {
    genGen += 1; // invalidate any generation loop still mid-flight (see typeGenerated)
    invalidatePilot();
    if (flowTimer) {
      window.clearTimeout(flowTimer);
      flowTimer = undefined;
    }
    for (const id of activeAskIds(view.state)) {
      view.dispatch({ effects: removeAiAsk.of(id) });
    }
    envLabel = ENV_PLACEHOLDER;
    sectionsState = { ...DEFAULT_SECTIONS };
    sectionsAnswered = false;
    view.scrollDOM.scrollTop = 0;
    applyDoc(buildDoc(envLabel, sectionsState, sectionsAnswered), false);
    addCard1();
  }

  function reconcile(): void {
    const allowed = canAutoRun();
    if (allowed && !lastAllowed) {
      hardReset();
    } else if (!allowed && lastAllowed) {
      invalidatePilot(); // just stop scripting; leave the current card/doc as-is
    }
    lastAllowed = allowed;
  }

  function noteUserActivity(): void {
    if (!userOverride) {
      userOverride = true;
      reconcile();
    }
    restartIdleResumeTimer();
  }

  function restartIdleResumeTimer(): void {
    if (idleResumeTimer) window.clearTimeout(idleResumeTimer);
    idleResumeTimer = window.setTimeout(() => {
      userOverride = false;
      reconcile();
    }, IDLE_RESUME_MS);
  }

  /** A fresh card landing while a visitor is in control is itself something
   * worth reacting to — without this, the idle clock keeps counting from
   * their last click, and the auto-loop can resume (wiping the card just
   * shown to them) before they've had a real chance to read or answer it.
   * No-op while the loop is driving itself. */
  function extendIdleWindowIfOverridden(): void {
    if (userOverride) restartIdleResumeTimer();
  }

  // Capture phase: the free-text input calls stopPropagation() on its own
  // mousedown (see ai-ask.ts), which would otherwise stop a bubble-phase
  // listener here from ever seeing a click that starts inside it.
  container.addEventListener('pointerenter', noteUserActivity);
  container.addEventListener('pointerdown', noteUserActivity, { capture: true });
  container.addEventListener('keydown', noteUserActivity, { capture: true });

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      if (entry) onScreen = entry.isIntersecting;
      reconcile();
      flushRunnableWaiters();
    },
    { threshold: 0 }
  );
  intersectionObserver.observe(container);

  function onVisibilityChange(): void {
    reconcile();
    flushRunnableWaiters();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  lastAllowed = canAutoRun();
  addCard1();

  watchRemoval(container, () => {
    alive = false;
    invalidatePilot();
    if (flowTimer) window.clearTimeout(flowTimer);
    if (idleResumeTimer) window.clearTimeout(idleResumeTimer);
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    flushRunnableWaiters();
    destroy();
  });
}
