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
- Task selections (multiple selected checkboxes)
- Link selections (multiple selected HTTP(S) links for batch open/title operations)
- Footnotes (`[^1]` reference)

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
    - Command executes on-demand when called by main plugin
    - Delegates detection to `contextDetection.ts`
    - Returns **array of contexts** (supports multiple simultaneous contexts)

2. **Main Plugin** (menus.ts):
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
- `EditorContext = LinkContext | CodeContext | CheckboxContext | TaskSelectionContext | FootnoteContext | LinkSelectionContext`
- `LinkType` enum (ExternalUrl, JoplinResource, Email, InternalAnchor)
- `TaskInfo` interface for individual tasks in selections
- `LinkInfo` interface for individual links in selections
- Command IDs (including checkbox, footnote, fetch title, and batch open commands)
- `EditorRange` for text replacement operations

**src/settings.ts**

- Settings registration using Joplin Settings API
- Centralized `SETTINGS_CONFIG` object defines all settings with metadata (key, defaultValue, label, description)
- 15 boolean settings (all default `true`):
    - `showToastMessages` - Show toast notifications
    - `showOpenLink` - Show "Open Link" in context menu
    - `showAddExternalLink` - Display option to insert a hyperlink at the cursor
    - `showAddLinkToNote` - Display option to link to another note at the cursor
    - `showCopyPath` - Show "Copy Path" in context menu
    - `showRevealFile` - Show "Reveal File" in context menu
    - `showCopyCode` - Show "Copy Code" in context menu
    - `showCopyOcrText` - Show "Copy OCR Text" in context menu
    - `showToggleTask` - Show task toggle options in context menu
    - `showGoToFootnote` - Show "Go to footnote" in context menu
    - `showGoToHeading` - Show "Go to heading" in context menu
    - `showPinToTabs` - Show "Open Note as Pinned Tab" in context menu (requires Note Tabs plugin)
    - `showOpenNoteNewWindow` - Show "Open Note in New Window" in context menu
    - `showFetchLinkTitle` - Show "Fetch Link Title" in context menu
    - `showOpenAllLinksInSelection` - Show "Open All Links" in context menu
- Settings accessed via `settingsCache` object (e.g., `settingsCache.showToastMessages`)

**src/menus.ts**

- Context menu filter (`joplin.workspace.filterEditorContextMenu`)
- Pulls contexts on-demand from content script via `editor.execCommand` (returns array) **only when** at least one context-sensitive menu option is enabled; otherwise it skips context detection and only adds non-context-sensitive (“global”) menu items
- Supports multiple contexts at same position (e.g., code + checkbox)
- Distinguishes between note links and resource links using `isJoplinNote()` helper
- Resource-specific options (Copy Path, Reveal File) only shown for actual resources
- Checks settings before adding menu items
- Adds separator if ≥1 menu item will be shown, and between context-sensitive and non-context sensitive menu items

**src/commands.ts**

- Command handlers for:
    - Open Link (external URLs → browser, resources → default app)
    - Copy Path (URLs → clipboard, resources → file path)
    - Reveal File (resources only → file explorer)
    - Copy Code (code blocks → clipboard)
    - Copy OCR Text (image resources → clipboard)
    - Toggle Checkbox (single checkbox `[ ]` ↔ `[x]`)
    - Check All Tasks (bulk check unchecked tasks in selection)
    - Uncheck All Tasks (bulk uncheck checked tasks in selection)
    - Go to Footnote (scrolls to footnote definition)
    - Go to Heading (navigates to heading via Joplin's `jumpToHash` command)
    - Open Note as Pinned Tab (opens note as pinned tab via Note Tabs plugin)
    - Open Note in New Window (opens note in a new Joplin window)
    - Fetch Link Title (fetches web page title for single HTTP(S) link)
    - Fetch All Link Titles (batch fetches titles for all HTTP(S) links in selection)
    - Open All Links (batch opens all HTTP(S) links in selection in order)
- All commands show toast notifications (if enabled)

**src/contentScripts/contentScript.ts**

- CodeMirror 6 content script entry point (type: CodeMirrorPlugin)
- Registers commands:
    - `contextUtils-getContextAtCursor` - delegates to `contextDetection.ts`
    - `contextUtils-replaceRange` - text replacement for checkbox toggling
    - `contextUtils-batchReplace` - atomic batch replacement for bulk operations
    - `contextUtils-scrollToPosition` - scrolls editor to specific position (for footnotes)

**src/contentScripts/contextDetection.ts**

- Multi-context detection logic (returns array of contexts)
- Delegates parsing to `parsingUtils.ts`
- Detection priority: Code > Links > Images > Footnotes (checkboxes run alongside as secondary context)
- Uses text scanning for footnotes (syntax tree doesn't detect them)

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

**src/utils/linkTitleUtils.ts**

- Title fetching utilities:
    - `fetchLinkTitle` - Fetches page title from URL with 10s timeout, returns `{ title, isFallback }`
    - `sanitizeLinkTitle` - Removes square brackets from titles (would break markdown syntax)
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
type EditorContext = LinkContext | CodeContext | CheckboxContext | TaskSelectionContext | FootnoteContext;

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

interface CheckboxContext {
    contextType: 'checkbox'; // Discriminator
    checked: boolean;
    lineText: string;
    from: number;
    to: number;
}

interface TaskSelectionContext {
    contextType: 'taskSelection'; // Discriminator
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

### 3. Checkbox Detection and Toggling

**Detection Strategy:**

1. **Selection check** - If there's a text selection, check for tasks first (returns single `TaskSelectionContext`)
2. **Primary context** - Detect code/links/images via syntax tree (Priority: Code > Links > Images)
3. **Secondary context** - Check if on a checkbox line (runs alongside primary, enables multi-context support)

**Checkbox Detection:**
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

// Step 2: Only if in task list, match checkbox pattern
// Matches: "  - [ ] Task" or "    * [x] Done"
const checkboxMatch = lineText.match(/^(\s*[-*+]\s+)\[([x ])\]/);
```

Features:

- Supports list markers: `-`, `*`, `+`
- Supports indentation (nested task lists)
- Checkbox states: lowercase `x` (checked) or space (unchecked)
- Detects anywhere on the task line (not just on the checkbox)
- Prevents false positives by only checking `Task` nodes (not plain text in code blocks)

**Task Selection Detection:**

1. Iterates syntax tree once for entire selection range (O(N))
2. Validates `Task` nodes directly during traversal
3. Deduplicates tasks (handles multiple Task nodes per line)
4. Counts checked vs unchecked tasks
5. Returns `TaskSelectionContext` if tasks found

**Link Selection Detection:**

1. Iterates syntax tree for selection range looking for `Link`, `URL`, `Autolink` nodes
2. Only includes external HTTP(S) URLs (excludes Joplin resources, emails, anchors)
3. Excludes reference-style links (no inline URL to replace)
4. Returns `LinkSelectionContext` if external links found
5. Both task and link selections can be returned together (if selection contains both)

**Text Replacement:**
Uses two commands for atomic operations:

1. `contextUtils-replaceRange`: For single checkbox toggling
    - Accepts `expectedText` for **optimistic concurrency control**
    - Verifies content hasn't changed before replacing
2. `contextUtils-batchReplace`: For bulk operations
    - Accepts array of replacements with `expectedText`
    - **Atomic Transaction**: Applies all changes in a single CodeMirror transaction (one undo step)
    - Aborts entire batch if any line doesn't match expectation

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

- **Note links**: Show "Open Note" only (no Copy Path or Reveal File)
- **Resource links**: Show "Open Resource", "Copy Resource Path", "Reveal File in Folder"
- **Invalid IDs**: Treated as neither (no menu items shown)

This prevents errors when trying to get file paths for notes (which don't have physical files in the resources directory) and ensures robust handling of invalid IDs.

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

- All settings default to `true`
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
