# Context Utils Plugin - Architecture Documentation

> Internal documentation for LLM reference. Describes plugin architecture, file structure, and key patterns.

## Overview

Joplin plugin that adds context-aware menu options when right-clicking on links, images, and code in the markdown editor. Uses CodeMirror 6 syntax tree for robust detection.

**Supported Contexts:**

- External URLs (`https://...`)
- Joplin resources (`:/32-hex-id`)
- Email addresses (`mailto:...` and angle-bracket autolinks such as `<user@example.com>`)
- Internal anchor links (`#heading-slug`)
- Markdown links (`[text](url)`)
- Reference-style links (`[text][ref]` with `[ref]: url`)
- Markdown images (`![alt](url)`)
- HTML images (`<img src="...">`)
- Inline code (`` `code` ``)
- Code blocks (` ` ```)
- Task list checkboxes (`- [ ]` / `- [x]`)
- Task contexts (single task or multiple selected checkboxes)
- Link selections (multiple selected HTTP(S) links for batch open/title operations)
- Footnotes (`[^1]` reference)
- Headings (`# Heading` / Setext) for copying internal/external heading links
- Block quotes (`> Quote`) for copying quote contents
- Contextual Copy command for copying the innermost copy-capable context at the cursor

**Editor behaviors:**

- Optional list paste cleanup: removes a duplicate list marker from pasted text when pasting directly after an existing list marker, re-indents the remaining pasted lines to the target line's level, converts pasted sibling items to the target's list type, and renumbers the following ordered list items when an ordered list is pasted onto an ordered list item

## Architecture

### Core Components

```
┌─────────────────┐
│   index.ts      │  Plugin entry point
│                 │  - Registers settings
│                 │  - Registers content script
│                 │  - Registers commands
│                 │  - Registers context menu filter
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┬──────────┐
    │         │          │          │          │
    v         v          v          v          v
┌────────┐ ┌───────┐ ┌────────┐ ┌─────────┐ ┌──────────┐
│settings│ │menus  │ │commands│ │  types  │ │ content  │
│  .ts   │ │  .ts  │ │  .ts   │ │   .ts   │ │ scripts/ │
└────────┘ └───────┘ └────────┘ └─────────┘ └──────────┘
```

### Data Flow ("Pull" Architecture)

1. **Content Script** (contentScript.ts):
    - Registers command `contextUtils-getContextAtCursor` using `codeMirrorWrapper.registerCommand()`
    - Registers command `contextUtils-isEditorContextMenuOrigin` by tracking recent editor `contextmenu` events
    - Command executes on-demand when called by main plugin
    - Delegates detection to `contextDetection.ts`
    - Returns **array of contexts** (supports multiple simultaneous contexts)

2. **Main Plugin** (menus.ts):
    - First calls `contextUtils-isEditorContextMenuOrigin`; if false, only the viewer task toggle can be added (see Viewer Task Toggle)
    - When context menu opens, calls `joplin.commands.execute('editor.execCommand', { name: 'contextUtils-getContextAtCursor' })`
    - Awaits contexts directly from editor (guaranteed to match cursor position)
    - Iterates through returned contexts array
    - Builds context menu dynamically with items for all detected contexts

3. **Commands** (commands.ts):
    - Execute actions when menu items are clicked
    - Use Joplin API for clipboard, file operations, URL opening

**Key Benefits of Pull Architecture:**

- ✅ Zero race conditions (context always matches cursor position)
- ✅ Zero overhead (detection only runs on right-click, not every cursor movement)
- ✅ Simpler context flow (no background context synchronization)
- ✅ Multi-context support (can show multiple relevant options simultaneously)

## File Structure

| Area | Responsibility |
| --- | --- |
| `src/index.ts` | Plugin entry point; registers settings, the content script, commands, and the editor menu filter. |
| `src/types.ts` and `src/settings.ts` | Shared context and command types, plus settings registration and reads. |
| `src/menus.ts` and `src/commands.ts` | Build menu items from detected contexts and handle the actions they trigger. |
| `src/contentScripts/` | CodeMirror-side integration: context detection and parsing, heading and quote extraction, editor text replacement, and optional paste cleanup. `contentScript.ts` connects this work to the main plugin. |
| `src/utils/` | Focused helpers for task toggling, contextual copy, link titles, heading links, URLs, and toasts. |
| `src/viewerContextMenu.ts` and `src/viewerTasks.ts` | Markdown viewer task toggling: viewer message handling and the viewer/editor task contract. |
| `src/logger.ts` | Shared, prefixed logging. |

Tests live beside the modules they cover as `*.test.ts` files.

## Key Patterns

### 1. Discriminated Unions

```typescript
type EditorContext =
    | LinkContext
    | CodeContext
    | TaskContext
    | FootnoteContext
    | LinkSelectionContext
    | HeadingContext
    | QuoteContext;

interface LinkContext {
    contextType: 'link'; // Discriminator
    url: string;
    type: LinkType;
    from: number;
    to: number;
}

interface CodeContext {
    contextType: 'code'; // Discriminator
    code: string;
    from: number;
    to: number;
}

interface TaskContext {
    contextType: 'task'; // Discriminator
    tasks: TaskInfo[];
    checkedCount: number;
    uncheckedCount: number;
    from: number;
    to: number;
}

interface FootnoteContext {
    contextType: 'footnote'; // Discriminator
    label: string;
    targetPos: number;
    from: number;
    to: number;
}

interface LinkSelectionContext {
    contextType: 'linkSelection'; // Discriminator
    links: LinkInfo[];
    from: number;
    to: number;
}

interface HeadingContext {
    contextType: 'heading'; // Discriminator
    headingText: string;
    headingAnchor: string;
    from: number;
    to: number;
}

interface QuoteContext {
    contextType: 'quote'; // Discriminator
    quoteText: string;
    from: number;
    to: number;
}
```

`LinkContext` includes optional fields for markdown links:

- `markdownLinkFrom`/`markdownLinkTo` - Full `[text](url)` range
- `linkTitleToken` - Optional raw title attribute token from `[text](url "title")`
- `isReferenceLink` - True for reference-style links (excluded from Fetch Title)

TypeScript uses `contextType` to narrow types safely.

### 2. Hybrid Detection Approach

The plugin uses **syntax tree traversal for links** (robust) and a **hybrid approach for code** (practical).

**For Links - Syntax Tree (Robust):**

Bad (regex, fragile):

```typescript
const match = linkText.match(/\[([^\]]+)\]\(([^)]+)\)/);
// Breaks on nested parentheses: [text](https://example.com/foo(bar))
```

Good (syntax tree, robust):

```typescript
function extractUrlFromLinkNode(node: SyntaxNode, view: EditorView): string | null {
    const cursor = node.cursor();
    if (!cursor.firstChild()) return null;

    do {
        if (cursor.name === 'URL') {
            return view.state.doc.sliceString(cursor.from, cursor.to);
        }
    } while (cursor.nextSibling());

    return null;
}
```

**For Code - Hybrid Approach:**

- **Inline code**: Regex (because `InlineCode` nodes include backticks)
- **Fenced code blocks**: Syntax tree to extract `CodeText` children, with regex fallback
- **Indented code blocks**: Syntax tree to collect multiple `CodeText` children (one per line)

### 3. Task Detection and Toggling

**Detection Strategy:**

1. **Selection check** - If any CodeMirror selection range contains tasks, aggregate them first (returns single `TaskContext`)
2. **Primary context** - Detect code/links/images via syntax tree (Priority: Code > Links > Images)
3. **Secondary context** - Check if on a task line (runs alongside primary, enables multi-context support)

**Task Detection:**
Two-step validation to prevent false positives:

1. **Syntax tree check** - Verify cursor is inside `Task` node
2. **Pattern matching** - If in task node, check line text for checkbox pattern

```typescript
// Step 1: Verify we're in a Task node via syntax tree
tree.iterate({
    from: pos,
    to: pos,
    enter: (node) => {
        if (node.name === 'Task') {
            isInTaskList = true;
            return false;
        }
    },
});

// Shared pattern used by single-line and selection detection.
// Matches: "  - [ ] Task", "    * [x] Done", "> - [ ] Quoted",
// and nested block quotes like "> > - [x] Done".
const TASK_CHECKBOX_PATTERN = /^(\s*(?:>\s*)*[-*+]\s+)\[([x ])\]/;

// Step 2: Only if in task list, match checkbox pattern
const checkboxMatch = lineText.match(TASK_CHECKBOX_PATTERN);
```

Features:

- Supports list markers: `-`, `*`, `+`
- Supports indentation (nested task lists)
- Supports task lists inside block quotes, including nested quote markers (`> - [ ] Task`, `> > - [x] Task`)
- Checkbox states: lowercase `x` (checked) or space (unchecked)
- Detects anywhere on the task line (not just on the checkbox)
- Prevents false positives by only checking `Task` nodes (not plain text in code blocks)

**Task Context Detection:**

1. Scans all CodeMirror selection ranges for task toggling
2. Empty cursor ranges collect the task line under that cursor
3. Non-empty ranges iterate the syntax tree for tasks intersecting the selection
4. Deduplicates tasks by line position and sorts them in document order
5. Counts checked vs unchecked tasks and returns one unified `TaskContext`

**Task Toggle Behavior:**

1. A single command (`contextUtils.toggleCheckbox`) handles both single tasks and selected tasks
2. If any affected task is unchecked, only unchecked tasks are checked
3. If all affected tasks are checked, checked tasks are unchecked
4. Mixed multi-cursor or multi-selection task sets do not invert checked tasks; they check unchecked tasks and leave checked tasks unchanged

**Viewer Task Toggle:**

Selecting text across tasks in the desktop markdown viewer and right-clicking offers the same toggle item as the editor. The editor selection does not change.

- `contentScripts/viewerContentScript.ts` is a markdown-it content script whose only job is loading the `viewerContextMenu.js` asset. No render changes are needed: Joplin stamps every task `<li>` with `source-line` (0-based source line) when rendering the viewer.
- `contentScripts/viewerContextMenu.js` (plain script, capture-phase `contextmenu`) posts `{ tasks, clickedAt }` on every viewer right-click. `tasks` lists `{ line, checked }` for each `li.md-checkbox` whose checkbox wrapper has selected text, or is null. It tests the wrapper rather than the `<li>` so a parent item is not included when only its nested task is selected, and requires selected text so a selection that only touches an item's start boundary (triple-click) does not include it.
- `viewerContextMenu.ts` receives those messages. For a non-editor-origin menu (in Code View, with Toggle Task enabled), the filter takes the click message from at or before that menu's start, waiting briefly if Joplin's menu request arrived first. Each message is consumed by one menu, and timed-out or editor-origin menus discard older messages so a delayed message cannot target a later menu. The logic mirrors the viewer image support in the Simple Image Resize plugin.
- `contextUtils-resolveViewerTasks` (`resolveViewerTasks` in `contextDetection.ts`) parses the syntax tree through the last line (`ensureSyntaxTree`, 200ms budget), then maps each line to a task. It returns null if any line is not a task or its checkbox state differs from what the viewer rendered (stale render). The resulting `TaskContext` becomes the toggle item's `commandArgs`, so the command runs the normal batch replace with `expectedText` checks.
- Only the task toggle is offered in the viewer; global items (Add External Link, etc.) are editor-only.
- Joplin's viewer only opens a context menu over a text selection, link, or resource, so a single task cannot be toggled from the viewer without selecting some of its text.

**Link Selection Detection:**

1. Iterates syntax tree for selection range looking for `Link`, `URL`, `Autolink` nodes
2. Only includes external HTTP(S) URLs (excludes Joplin resources, emails, anchors)
3. Excludes reference-style links (no inline URL to replace)
4. Returns `LinkSelectionContext` if external links found
5. Link batch detection scans all non-empty selection ranges, deduplicates overlapping matches, and sorts links by document position
6. Cursor-only ranges are handled by the single-link path; mixed cursor/selection ranges use selected links plus any detected task contexts

**Text Replacement:**
Uses a single batch replacement command for all in-place edits:

- `contextUtils-batchReplace` handles task toggles and link-title updates (one or many ranges), each carrying `expectedText`
- Batch replacement applies all changes in a single CodeMirror transaction (one undo step)
- Batch replacement aborts if any range doesn't match its expected text
- Link-title replacements set `selectionBehavior: 'expand'` so selected links stay fully selected when the fetched-title markdown is longer than the original link text

### 4. Note vs Resource Distinction

Joplin uses the same `:/32-hex-id` syntax for both note links and resource (attachment) links. The content script cannot distinguish between them (it only sees text).

The main plugin (menus.ts) uses the `getJoplinIdType()` helper to check if an ID is a note or a resource. It uses `Promise.any` to check both endpoints concurrently:

```typescript
async function getJoplinIdType(id: string): Promise<'note' | 'resource' | null> {
    try {
        const { type } = await Promise.any([
            joplin.data.get(['notes', id], { fields: ['id'] }).then(() => ({ type: 'note' as const })),
            joplin.data.get(['resources', id], { fields: ['id'] }).then(() => ({ type: 'resource' as const })),
        ]);
        return type;
    } catch {
        // AggregateError: all promises rejected (ID doesn't exist as note or resource)
        return null;
    }
}
```

**Menu Behavior:**

- **Note links**: Show note-specific action only ("Open Note as Pinned Tab")
- **Resource links**: No plugin-specific open/copy/reveal items (Joplin native menu handles these)
- **Invalid IDs**: Treated as neither (no menu items shown)

This ensures note-specific actions are only shown for real notes, avoids redundant resource options, and keeps handling robust for invalid IDs.

### 5. Footnote Detection

Footnotes in CodeMirror aren't parsed as distinct syntax nodes. To ensure robust detection:

1.  **Primary Check**: Syntax tree traversal (standard flow).
2.  **Fallback Check**: If no other context is found, the plugin scans the current line text for footnote references `[^label]`.
3.  **Definition Lookup**: Once a label is found, `findFootnoteDefinition` scans the document using codemirror's RegExpCursor to find the corresponding `[^label]:` definition.

## Important Notes

### CodeMirror 6 Syntax Nodes

**Markdown:**

- `Link` - `[text](url)` or `[text][ref]` (entire structure with `URL` or `LinkLabel` child nodes)
- `LinkReference` - Reference definition `[ref]: url` (contains `LinkLabel` and `URL` children)
- `LinkLabel` - Label in reference links (e.g., `[ref]` in `[text][ref]` or `[ref]: url`)
- `Image` - `![alt](url)` (entire structure with `URL` child nodes)
- `URL` - Bare URLs or child nodes of Link/Image/LinkReference
- `Autolink` - `<url>` or `<user@example.com>` (email autolinks are classified as mailto links; bare `user@example.com` text is not)
- `InlineCode` - `` `code` `` (flat/leaf node, includes backticks)
- `FencedCode` - ` ` ```code blocks (may have`CodeText` child excluding fence markers)
- `CodeBlock` - Indented code blocks (4 spaces/tab, has multiple `CodeText` children, one per line)
- `CodeText` - Content of code blocks (single child for fenced, multiple children for indented)
- `Task` - Task list items with checkboxes (GFM extension, e.g., `- [ ] Task`)

**HTML in Markdown:**

- `HTMLTag` - Entire tag (no internal structure)
- Must use regex for `<img src="...">` parsing (acceptable here)

**Code Node Details:**

- `InlineCode` - Leaf node with backticks included (`` `code` ``)
- `FencedCode` - Single `CodeText` child (excludes fence markers)
- `CodeBlock` - Multiple `CodeText` children, one per line (includes trailing newlines)

### Settings Best Practices

- Menu/toggle settings default to `true`; `linkPreviewApiKey` defaults to an empty string
- **Read settings at the entry point** (menu filter, command handler, message handler) with `getSettings()`/`getSetting()` and pass the snapshot down; never keep settings in module state (it can go stale)
- Settings changes apply immediately (no restart needed)

### Error Handling

- Commands wrap handlers in try/catch
- Show error toasts on failure
- Log errors to console
- Context menu filter catches errors to avoid breaking Joplin's menu

## Build Configuration

**plugin.config.json:**

```json
{
    "extraScripts": ["contentScripts/contentScript.ts"]
}
```

Content scripts must be declared here for webpack bundling.
