# Context Utils Plugin - Architecture Documentation

> Internal documentation for LLM reference. Describes plugin architecture, file structure, and key patterns.

## Overview

Joplin plugin that adds context-aware menu options when right-clicking on links, images, and code in the markdown editor. Uses CodeMirror 6 syntax tree for robust detection.

**Supported Contexts:**

- External URLs (`https://...`)
- Joplin resources (`:/32-hex-id`)
- Email addresses (`mailto:...`)
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
- Initialization order matters (settings → settings cache → content script → commands → menu)

**src/types.ts**

- Type definitions with discriminated unions
- `EditorContext = LinkContext | CodeContext | TaskContext | FootnoteContext | LinkSelectionContext | HeadingContext | QuoteContext`
- `LinkType` enum (ExternalUrl, JoplinResource, Email, InternalAnchor)
- `TaskInfo` interface for individual tasks in task contexts
- `LinkInfo` interface for individual links in selections
- Command IDs (including task toggle, footnote, fetch title, and batch open commands)
- `EditorRange` for text replacement operations

**src/settings.ts**

- Settings registration using Joplin Settings API
- Centralized `SETTINGS_CONFIG` object defines all settings with metadata (key, defaultValue, type, label, description)
- 14 boolean settings (all default `true`) plus 1 enum string setting and 1 secure string setting:
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
- Adds separator if ≥1 menu item will be shown, and between context-sensitive and non-context sensitive menu items

**src/commands.ts**

- Command handlers for:
    - Open Link (external URLs → browser, emails → default mail app)
    - Copy URL/Email (URLs/emails → clipboard)
    - Copy Code (code blocks → clipboard)
    - Toggle Task (single task, selected tasks, or multiple cursors/selections)
    - Go to Footnote (scrolls to footnote definition)
    - Go to Heading (navigates to heading via Joplin's `jumpToHash` command)
    - Open Note as Pinned Tab (opens note as pinned tab via Note Tabs plugin)
    - Fetch Link Title (fetches web page title for single HTTP(S) link)
    - Fetch All Link Titles (batch fetches titles for all HTTP(S) links in selection)
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
    - `contextUtils-replaceRange` - single-range text replacement for link-title updates
    - `contextUtils-batchReplace` - atomic batch replacement for bulk operations
    - `contextUtils-scrollToPosition` - scrolls editor to specific position (for footnotes)

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
    - `parseInlineCode` (regex)
    - `parseCodeBlock` (syntax tree + regex fallback)
    - `findFootnoteDefinition` (RegExpCursor with code block filtering)

**src/contentScripts/headingExtraction.ts**

- Detects the heading at the cursor and generates its anchor/slug
- `getHeadingAtPosition(view, pos)` walks the whole syntax tree to build the ordered anchor list (so duplicate slugs get `-2`, `-3`, ... suffixes) and returns the heading under the cursor
- Slugify (`@joplin/fork-uslug`), duplicate handling, and inline-text extraction are kept in sync with the [joplin-heading-navigator](https://github.com/bwat47/joplin-heading-navigator/blob/main/src/headingExtractor.ts) plugin so anchors match Joplin's rendered heading IDs

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
5. Link batch detection remains scoped to the main selection range; multi-cursor aggregation currently applies only to task toggling
6. Both task and link selections can be returned together (if the main selection contains links and any range contains tasks)

**Text Replacement:**
Uses single-range and batch replacement commands:

- `contextUtils-replaceRange` handles single link-title updates with `expectedText`
- `contextUtils-batchReplace` handles task and batch link operations
- Batch replacement applies all changes in a single CodeMirror transaction (one undo step)
- Batch replacement aborts if any line doesn't match expectation

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
- `Autolink` - `<url>`
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
