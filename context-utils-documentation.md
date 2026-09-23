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
    - First calls `contextUtils-isEditorContextMenuOrigin`; if false, injects no plugin menu items
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
- ✅ Simpler code (no message passing, no global state)
- ✅ Multi-context support (can show multiple relevant options simultaneously)

## File Structure

### Core Files

**src/index.ts**

- Plugin registration and initialization
- Coordinates all subsystems
- Initialization order matters (settings → settings cache → content script message handler → content script → commands → menu)
- Registers a `joplin.contentScripts.onMessage` handler (before the content script, so the first request cannot race it) that answers `GET_CONTENT_SCRIPT_SETTINGS_MESSAGE` with `ContentScriptSettings` from `settingsCache`

**src/types.ts**

- Type definitions with discriminated unions
- `EditorContext = LinkContext | CodeContext | TaskContext | FootnoteContext | LinkSelectionContext | HeadingContext | QuoteContext`
- `LinkType` enum (ExternalUrl, JoplinResource, Email, InternalAnchor)
- `TaskInfo` interface for individual tasks in task contexts
- `LinkInfo` interface for individual links in selections
- Command IDs (including task toggle, footnote, fetch title, and batch open commands)
- `TextReplacement` payload for editor text replacement operations
- `GET_CONTENT_SCRIPT_SETTINGS_MESSAGE`, `ContentScriptMessage`, `ContentScriptSettings` for content script → plugin settings requests

**src/settings.ts**

- Settings registration using Joplin Settings API
- Centralized `SETTINGS_CONFIG` object defines all settings with metadata (key, defaultValue, type, label, description)
- 15 boolean settings (all default `true` except `cleanUpListPaste`) plus 1 enum string setting, 1 secure string setting, and 1 JSON string setting:
    - `showToastMessages` - Show toast notifications
    - `showOpenLink` - Show "Open Link" in context menu
    - `showAddExternalLink` - Display option to insert a hyperlink at the cursor
    - `showAddLinkToNote` - Display option to link to another note at the cursor
    - `showCopyPath` - Show "Copy URL/Email" in context menu
    - `showCopyCode` - Show "Copy Code" in context menu
    - `showToggleTask` - Show task toggle options in context menu
    - `showGoToFootnote` - Show "Go to footnote" in context menu
    - `showGoToHeading` - Show "Go to heading" in context menu
    - `showPinToTabs` - Show "Open Note as Pinned Tab" in context menu (requires Note Tabs plugin)
    - `showFetchLinkTitle` - Show "Fetch Link Title" in context menu
    - `showCopyHeadingLink` - Show "Copy Heading Link" (internal/external) in context menu
    - `showCopyQuote` - Show "Copy Quote" in context menu
    - `defaultHeadingCopyMode` - Heading link format used by Contextual Copy (`internal` or `external`; defaults to `internal`)
    - `showOpenAllLinksInSelection` - Show "Open All Links" in context menu
    - `linkPreviewApiKey` - Optional secure `linkpreview.net` API key used as the primary title provider
    - `linkTitleRules` - JSON array of `{pattern, title, flags?}` rules for deriving a link title from the URL without fetching; defaults to a Jira issue-link rule
    - `cleanUpListPaste` - Clean up pasted list items (duplicate list marker removal, re-indentation, list type conversion, and ordered list renumbering) (default `false`; consumed by the content script)
- Settings accessed via `settingsCache` object (e.g., `settingsCache.showToastMessages`)

**src/menus.ts**

- Context menu filter (`joplin.workspace.filterEditorContextMenu`)
- Registers `Toggle Task` in the application Edit menu with `Ctrl+Shift+Space`
- Registers `Contextual Copy` in the application Edit menu with `CmdOrCtrl+Shift+X`
- Pulls contexts on-demand from content script via `editor.execCommand` (returns array) **only when** at least one context-sensitive menu option is enabled; otherwise it skips context detection and only adds non-context-sensitive (“global”) menu items
- Supports multiple contexts at same position (e.g., code + task)
- Distinguishes between note links and resource links using `getJoplinIdType()` helper
- Note-specific options are limited to "Open Note as Pinned Tab"
- Checks settings before adding menu items
- Adds separators before and after the Context Utils items if ≥1 item will be shown, and between context-sensitive and non-context-sensitive items

**src/commands.ts**

- Command handlers for:
    - Open Link (external URLs → browser, emails → default mail app)
    - Copy URL/Email (URLs/emails → clipboard)
    - Copy Code (code blocks → clipboard)
    - Toggle Task (single task, selected tasks, or multiple cursors/selections)
    - Go to Footnote (scrolls to footnote definition)
    - Go to Heading (navigates to heading via Joplin's `jumpToHash` command)
    - Open Note as Pinned Tab (opens note as pinned tab via Note Tabs plugin)
    - Fetch Link Title(s) (unified: fetches web page titles for the single HTTP(S) link at the cursor or every HTTP(S) link in the selection; one handler, one atomic batch replace)
    - Open All Links (batch opens all HTTP(S) links in selection in order)
    - Copy Heading Link (internal) (copies `[Heading](#anchor)` to clipboard)
    - Copy Heading Link (external) (copies `[Heading @ Note](:/noteId#anchor)`; resolves note via `joplin.workspace.selectedNote()`)
    - Copy Quote (copies block quote contents without quote markers)
    - Contextual Copy (pulls contexts at cursor and copies the first copy-capable target by priority: code → external/email link → heading → quote)
- All commands show toast notifications (if enabled)

**src/contentScripts/contentScript.ts**

- CodeMirror 6 content script entry point (type: CodeMirrorPlugin)
- Registers commands:
    - `contextUtils-getContextAtCursor` - delegates to `contextDetection.ts`
    - `contextUtils-isEditorContextMenuOrigin` - returns true only when right-click originated in editor recently
    - `contextUtils-batchReplace` - atomic batch replacement for all in-place edits (task toggles, link-title updates), one or many ranges
    - `contextUtils-scrollToPosition` - scrolls editor to specific position (for footnotes)
- Receives `ContentScriptContext` and fetches `ContentScriptSettings` once via `context.postMessage` on load (Joplin reloads the editor and content script when the Options screen closes, so no live push/refresh is needed). The `onMessage` handler in `index.ts` reads values with `readSettingValue()` (direct `joplin.settings.value()`) instead of `settingsCache`, because the reload can race ahead of the `onChange` cache refresh
- Installs the paste cleanup extension from `pasteCleanup.ts`, which reads the cached flag on each paste

**src/contentScripts/pasteCleanup.ts**

- `createPasteCleanupExtension(isEnabled)` - `EditorState.transactionFilter` that runs `cleanPasteTransaction` when enabled. A transaction filter is used instead of `EditorView.clipboardInputFilter` because Joplin desktop's Paste command (Ctrl+V / Edit > Paste) reads the clipboard itself and calls `insertText(text, 'input.paste')` (`replaceSelection`), bypassing CodeMirror's paste handler; CodeMirror's native paste uses the same `input.paste` user event, so both paths are covered
- `cleanPasteTransaction(tr)` - rewrites a single-change `input.paste` transaction with cleaned text; when the marker was removed, also applies `getPastedLineChanges` and `getListRenumberChanges`. The deletion and pasted line changes form one `ChangeSet` (post-paste coordinates, non-overlapping); renumbering is computed against the result of that `ChangeSet` so re-indented and converted pasted items count as siblings, and is appended as a second `sequential` spec. It all stays one transaction (single undo step); preserves annotations and maps the original selection and position-dependent effects through the edits
- `cleanPastedText(text, state, from)` - applies only for a single selection range whose line prefix (up to the paste position) is only indentation + list marker + optional task box, and whose syntax tree position is not inside code. A `ListItem` node is not required, because an empty marker line directly after a paragraph parses as a setext heading underline or paragraph continuation
- `stripDuplicateListMarker(linePrefix, pastedText)` - pure regex logic; strips the leading marker from the first pasted line. If the line has a task box, a pasted task box is also stripped; otherwise a pasted task box is kept
- `parseListItem(text)` - single parser for a line's list marker (indentation, token, ordered, delimiter, content start, task box), shared by the renumbering and pasted line logic
- `getListRenumberChanges(doc, firstLineNumber, linePrefix, tabSize)` - pure line walk over the post-paste document; only applies when `linePrefix` is an ordered marker (`N.` / `N)`, optional task box). Continues numbering from `N` for following lines: blank lines and lines indented at or past the item's content column (children, continuation lines) are skipped; a less indented line ends the walk; a sibling-level line must be an ordered marker with the same delimiter or the walk ends. Pasted and existing items are handled alike, and existing numbers are replaced unconditionally (matching Joplin's own renumbering, so `1. 1. 1.` lists become sequential)
- `getPastedLineChanges(doc, pasteFrom, pastedText, linePrefix, tabSize, formatIndent, parser)` - plans at most one edit per later non-blank pasted line (leading whitespace, plus the marker token when it changes). `parser` is the editor's own Markdown parser (`state.facet(language).parser`), so pasted text parses exactly as the editor would parse it; line changes are skipped if the state has no language:
    - Every line shifts by (target line indentation − pasted first line's original indentation), clamped at zero. Lines whose indentation width is unchanged keep their whitespace (so tabs aren't converted to spaces or vice versa); moved lines are written with the editor's indent unit (`indentString`)
    - The pasted text is parsed (`getPastedItems`) up to the first later line less indented than the pasted first line, with the first line's indentation removed from every line so items copied with deep nesting indentation still parse as a list rather than as code. The items of the list holding the pasted first item, and of any lists directly after it (CommonMark starts a new list when the bullet character or ordered delimiter changes), are the sibling items; each item's lines are its children. Sibling items take the target's list type: its bullet character, or sequential numbers with its delimiter (so pasted ordered items are numbered here too). Conversion stops where those lists end (a non-list top-level block), at the less indented line, or at a bullet task item when the target is ordered (left as a bullet, because Joplin's viewer does not render ordered task lists). Lazy continuation lines belong to their item, so they no longer stop conversion. Nested children keep their own type. Marker text is still read with `parseListItem`, since edits need the exact token
    - If the first pasted item is a bulleted task item and the target marker is numbered, the target marker becomes the pasted bullet. Later pasted siblings use that bullet, and ordered-list renumbering does not cross the new bullet item
    - A converted item's child lines move only if they would no longer be nested under its new marker (`getChildShift`). `describeItem` records each item's direct child blocks and the items of its direct child lists; the children shift the minimum amount that keeps all of them between the new content column and `MAX_CHILD_OFFSET` (3) columns past it. So 4-space or tab-indented children stay put when a marker changes between `- ` and `N. `, 2-space children under a widened marker move out by one column, and a deeper child is kept in range when narrowing (e.g. a child item 3 columns past a `10. ` marker's content, below a paragraph, when narrowing to `- `). An item whose only children are continuation lines keeps the least indented one in range instead. An item that directly contains an indented code block shifts its children by exactly the content column change, because a code block's meaning depends on its exact offset from the content column. Code blocks nested in a child item move with that child
    - Blank lines and document text after a paste ending in a newline are left alone. The pasted text is taken at face value: the first line's indentation is its original level. A copy that started at a nested item's marker (e.g. Home, then Shift+Down) lost that indentation and can't be told apart from a top-level item copied with its children, so its later sibling items nest under the first item. The reverse choice (leaving such pastes alone) left every child of a pasted top-level item at the wrong level, which is the more damaging failure
- Known limitations: pastes whose first line lost its indentation (copy started at a nested item's marker) nest their later sibling items under the first item, and a number width change (`9.` → `10.`) on existing items below the paste does not adjust their child indentation
- Blockquote prefixes are intentionally out of scope

**src/contentScripts/contextDetection.ts**

- Multi-context detection logic (returns array of contexts)
- Delegates parsing to `parsingUtils.ts`
- Detection priority: Code > Links > Images > Footnotes (tasks, headings, and block quotes run alongside as secondary contexts)
- Uses text scanning for footnotes (syntax tree doesn't detect them)
- Heading detection delegated to `headingExtraction.ts` (also a secondary context, so it coexists with code/links in a heading)
- Block quote detection delegated to `quoteExtraction.ts` (also a secondary context, so it coexists with code/links/headings inside quotes)

**src/contentScripts/parsingUtils.ts**

- Pure utility functions for parsing:
    - `extractUrl` (syntax tree traversal, includes position and optional link title)
    - `extractReferenceLabel` (syntax tree traversal for reference links)
    - `findReferenceDefinition` (finds URL for reference label, case-insensitive, first occurrence wins)
    - `parseImageTag` (regex)
    - `classifyUrl` (regex)
    - `classifyEmailAutolink` (regex; angle-bracket email autolinks only, with reserved local-part characters encoded in the `mailto:` URL and the original address retained for copying)
    - `parseInlineCode` (regex)
    - `parseCodeBlock` (syntax tree + regex fallback)
    - `findFootnoteDefinition` (RegExpCursor with code block filtering)

**src/contentScripts/headingExtraction.ts**

- Detects the heading at the cursor and generates its anchor/slug
- `getHeadingAtPosition(view, pos)` walks the whole syntax tree to build the ordered anchor list (so duplicate slugs get `-2`, `-3`, ... suffixes) and returns the heading under the cursor
- Slugify (`@joplin/fork-uslug`), duplicate handling, and inline-text extraction are kept in sync with the [joplin-heading-navigator](https://github.com/bwat47/joplin-heading-navigator/blob/main/src/headingExtractor.ts) plugin so anchors match Joplin's rendered heading IDs
- Math nodes (`InlineMath` / `BlockMath`) are copied verbatim rather than walked, since Joplin re-parses their content with a TeX parser and slugs the raw source for its own heading links; the test file approximates that grammar with a local inline-math markdown extension

**src/contentScripts/quoteExtraction.ts**

- Detects the outermost block quote at the cursor
- `getQuoteAtPosition(view, pos)` returns quote text with leading `>` markers removed from every quoted line
- Nested quote markers are normalized away while preserving inner markdown source such as links, code, headings, lists, and fenced blocks
- Leading alert markers matching `[!TEXT]` are removed from copied quote text; an inline title (e.g. `[!NOTE] Custom Title`) is preserved

**src/utils/headingLinkFormatting.ts**

- Pure formatters for heading links (kept in sync with joplin-heading-navigator's `linkFormatting.ts`):
    - `formatInternalHeadingLink(text, anchor)` → `[text](#anchor)`
    - `formatExternalHeadingLink(text, noteTitle, noteId, anchor)` → `[text @ noteTitle](:/noteId#anchor)`
    - `escapeLinkText` escapes `\ & < > [ ]` in link text

**src/utils/linkTitleUtils.ts**

- Title fetching utilities:
    - `fetchLinkTitle` - Applies custom link title rules first, then optionally tries `linkpreview.net`, falls back to direct page fetch, then domain fallback
    - `parseLinkTitleRules` - Parses/validates/compiles the `linkTitleRules` JSON string; logs and skips invalid JSON or individual rules (never throws)
    - `applyLinkTitleRules` - Returns the first matching rule whose title template produces a non-empty result (`$1`–`$9`, `$&`), or null
    - `sanitizeLinkTitle` - Removes square brackets and normalizes line breaks in titles for safe markdown link text
    - `extractDomain` - Extracts domain from URL for fallback title

### Utilities

**src/logger.ts**

- Centralized logging with log levels (DEBUG, INFO, WARN, ERROR)
- Exposes runtime controls via `console.contextUtils.setLogLevel()`
- Default level: WARN

**src/utils/toastUtils.ts**

- Toast notification wrapper
- Checks `settingsCache.showToastMessages` before showing
- Graceful error handling

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
- **Use `settingsCache` for synchronous access** (avoids async overhead)
- Cache is automatically updated via `joplin.settings.onChange`
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
