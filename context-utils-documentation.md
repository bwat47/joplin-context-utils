# Context Utils Plugin - Architecture Documentation

> Internal documentation for LLM reference. Describes plugin architecture, file structure, and key patterns.

## Overview

Joplin plugin that adds context-aware menu options when right-clicking on links, images, and code in the markdown editor. Uses CodeMirror 6 syntax tree for robust detection.

**Supported Contexts:**

- External URLs (`https://...`)
- Joplin resources (`:/32-hex-id`)
- Email addresses (`mailto:...`)
- Markdown images (`![alt](url)`)
- HTML images (`<img src="...">`)
- Inline code (`` `code` ``)
- Code blocks (` ` ```)
- **Task list checkboxes** (`- [ ]` / `- [x]`)
- **Task selections** (multiple selected checkboxes)

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

1. **Content Script** (linkDetection.ts):
    - Registers command `contextUtils-getContextAtCursor` using `codeMirrorWrapper.registerCommand()`
    - Command executes on-demand when called by main plugin
    - Traverses syntax tree to detect context at current cursor position

2. **Main Plugin** (menus.ts):
    - When context menu opens, calls `joplin.commands.execute('editor.execCommand', { name: 'contextUtils-getContextAtCursor' })`
    - Awaits context directly from editor (guaranteed to match cursor position)
    - Builds context menu dynamically based on returned context

3. **Commands** (commands.ts):
    - Execute actions when menu items are clicked
    - Use Joplin API for clipboard, file operations, URL opening

**Key Benefits of Pull Architecture:**
- ✅ Zero race conditions (context always matches cursor position)
- ✅ Zero overhead (detection only runs on right-click, not every cursor movement)
- ✅ Simpler code (no message passing, no global state)

## File Structure

### Core Files

**src/index.ts**

- Plugin registration and initialization
- Coordinates all subsystems
- Initialization order matters (settings → content script → commands → menu)

**src/types.ts**

- Type definitions with discriminated unions
- `EditorContext = LinkContext | CodeContext | CheckboxContext | TaskSelectionContext`
- `LinkType` enum (ExternalUrl, JoplinResource, Email)
- `TaskInfo` interface for individual tasks in selections
- Command IDs (including checkbox commands)
- `EditorRange` for text replacement operations

**src/settings.ts**

- Settings registration using Joplin Settings API
- 5 boolean settings (all default `true`):
    - `SETTING_SHOW_TOAST_MESSAGES`
    - `SETTING_SHOW_OPEN_LINK`
    - `SETTING_SHOW_COPY_PATH`
    - `SETTING_SHOW_REVEAL_FILE`
    - `SETTING_SHOW_COPY_CODE`

**src/menus.ts**

- Context menu filter (`joplin.workspace.filterEditorContextMenu`)
- Pulls context on-demand from content script via `editor.execCommand`
- Distinguishes between note links and resource links using `isJoplinNote()` helper
- Resource-specific options (Copy Path, Reveal File) only shown for actual resources
- Checks settings before adding menu items
- Only adds separator if ≥1 menu item will be shown

**src/commands.ts**

- Command handlers for:
    - Open Link (external URLs → browser, resources → default app)
    - Copy Path (URLs → clipboard, resources → file path)
    - Reveal File (resources only → file explorer)
    - Copy Code (code blocks → clipboard)
    - Copy OCR Text (image resources → clipboard)
    - **Toggle Checkbox** (single checkbox `[ ]` ↔ `[x]`)
    - **Check All Tasks** (bulk check unchecked tasks in selection)
    - **Uncheck All Tasks** (bulk uncheck checked tasks in selection)
- All commands show toast notifications (if enabled)

**src/contentScripts/linkDetection.ts**

- CodeMirror 6 content script (type: CodeMirrorPlugin)
- Hybrid detection approach:
    - Inline code: Regex (InlineCode nodes are flat/leaf nodes)
    - Fenced code blocks: Syntax tree traversal with regex fallback
    - Links/Images: Syntax tree traversal (robust for nested parentheses)
    - **Checkboxes**: Regex on line text (detects `- [ ]` / `- [x]` patterns)
    - **Task selections**: Line-by-line scanning of selection range
- **Priority: Code > Checkboxes > Links > Images > HTML**
- Registers commands:
    - `contextUtils-getContextAtCursor` - pull architecture for context detection
    - `contextUtils-replaceRange` - text replacement for checkbox toggling
- Detects selections and provides bulk operations when applicable

### Utilities

**src/logger.ts**

- Centralized logging with log levels (DEBUG, INFO, WARN, ERROR)
- Exposes runtime controls via `console.contextUtils.setLogLevel()`
- Default level: WARN

**src/utils/toastUtils.ts**

- Toast notification wrapper
- Checks `SETTING_SHOW_TOAST_MESSAGES` before showing
- Graceful error handling

## Key Patterns

### 1. Discriminated Unions

```typescript
type EditorContext = LinkContext | CodeContext | CheckboxContext | TaskSelectionContext;

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
```

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

- **Inline code**: Regex (because `InlineCode` nodes are flat/leaf nodes with backticks included)

    ```typescript
    // InlineCode node contains: `code`
    const match = codeText.match(/^`(.+)`$/s);
    return match ? { code: match[1] } : null;
    ```

- **Fenced code blocks**: Syntax tree with regex fallback
    ````typescript
    // Try to find CodeText child (excludes fence markers)
    if (cursor.name === 'CodeText') {
        return { code: view.state.doc.sliceString(cursor.from, cursor.to) };
    }
    // Fallback to regex if no CodeText child
    const match = codeText.match(/^```[^\n]*\n([\s\S]*?)```$/m);
    ````

### 3. Content Script Communication (Pull Architecture)

**Command registration pattern** - content script registers commands that main plugin calls on-demand:

```typescript
// Content script - register command
codeMirrorWrapper.registerCommand('contextUtils-getContextAtCursor', () => {
    const pos = view.state.selection.main.head;
    const context = detectContextAtPosition(view, pos);
    return context;
});

// Main plugin - call command when needed
const context = await joplin.commands.execute('editor.execCommand', {
    name: 'contextUtils-getContextAtCursor',
}) as EditorContext | null;
```

**Benefits over push architecture:**
- Direct request/response - no race conditions
- Only executes when needed - zero overhead during typing
- Guaranteed to return context for current cursor position

### 4. Checkbox Detection and Toggling

**Detection Priority:**
1. **Selection check** - If there's a text selection, check for tasks first
2. **Code blocks/inline code** - Highest priority for single context
3. **Checkboxes** - Task list items with `- [ ]` or `- [x]`
4. **Links** - Markdown and bare URLs
5. **Images** - Markdown and HTML images

**Checkbox Pattern Matching:**
```typescript
// Matches: "  - [ ] Task" or "    * [x] Done"
const checkboxMatch = lineText.match(/^(\s*[-*+]\s+)\[([x ])\]/);
```

Supports:
- List markers: `-`, `*`, `+`
- Indentation (nested task lists)
- Checkbox states: lowercase `x` (checked) or space (unchecked)
- Detection anywhere on the task line (not just on the checkbox)

**Task Selection Detection:**
When user has selected text:
1. Scans all lines in selection range
2. Identifies lines with task list checkboxes
3. Counts checked vs unchecked tasks
4. Returns `TaskSelectionContext` if tasks found

**Text Replacement:**
Uses `contextUtils-replaceRange` command:
- Validates inputs (positions must be finite numbers, from ≤ to)
- Performs atomic text replacement via CodeMirror dispatch
- Returns success/failure boolean
- Used for both single and bulk checkbox toggling

### 5. Note vs Resource Distinction

Joplin uses the same `:/32-hex-id` syntax for both note links and resource (attachment) links. The content script cannot distinguish between them (it only sees text).

The main plugin (menus.ts) uses the `isJoplinNote()` helper to check if an ID is a note:

```typescript
async function isJoplinNote(id: string): Promise<boolean> {
    try {
        await joplin.data.get(['notes', id], { fields: ['id'] });
        return true; // It's a note
    } catch {
        return false; // It's a resource or invalid ID
    }
}
```

**Menu Behavior:**

- **Note links**: Show "Open Note" only (no Copy Path or Reveal File)
- **Resource links**: Show "Open Resource", "Copy Resource Path", "Reveal File in Folder"

This prevents errors when trying to get file paths for notes (which don't have physical files in the resources directory).

## Important Notes

### CodeMirror 6 Syntax Nodes

**Markdown:**

- `Link` - `[text](url)` (entire structure with `URL` child nodes)
- `Image` - `![alt](url)` (entire structure with `URL` child nodes)
- `URL` - Bare URLs or child nodes of Link/Image
- `Autolink` - `<url>`
- `InlineCode` - `` `code` `` (flat/leaf node, includes backticks)
- `FencedCode` - ` ` ```(may have`CodeText` child excluding fence markers)
    - `CodeText` - Content of fenced code block (when present)
- `ListItem` - List items (may contain task checkboxes)
- `Task` - Task list items (GFM extension)

**HTML in Markdown:**

- `HTMLTag` - Entire tag (no internal structure)
- Must use regex for `<img src="...">` parsing (acceptable here)

**Important Note on Code Nodes:**

- In Joplin's markdown parser, `InlineCode` is a **leaf node** containing the full text including backticks (`` `code` ``)
- `FencedCode` may have `CodeText` children, but structure varies by parser implementation
- This is why the hybrid approach (regex for inline, tree traversal for fenced) is used

### Settings Best Practices

- All settings default to `true`
- Check settings asynchronously before operations
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
    "extraScripts": ["contentScripts/linkDetection.ts"]
}
```

Content scripts must be declared here for webpack bundling.

## Testing Considerations

- Enable debug logging: `console.contextUtils.setLogLevel(0)`
- Test with URLs containing special characters (nested parentheses, spaces, etc.)
- Verify settings changes apply without restart
- Check context detection at various cursor positions
- Test with both Joplin resources (attachments) and note links
    - Note links: Should only show "Open Note"
    - Resource links: Should show all resource options
- Test with external URLs and email addresses
- Test inline code and fenced code blocks (including nested backticks in fenced blocks)
- **Test checkbox toggling:**
    - Single checkbox: Cursor on `- [ ] Task` → shows "Check Task"
    - Single checkbox: Cursor on `- [x] Done` → shows "Uncheck Task"
    - Nested lists: `  - [ ] Nested` → detects correctly
    - Cursor position: Anywhere on task line → detects checkbox
    - Priority: `- [ ] [link](url)` → checkbox menu (not link menu)
- **Test bulk checkbox operations:**
    - Select multiple task lines → shows "Check All Tasks (N)" and/or "Uncheck All Tasks (N)"
    - Mixed selection with non-task lines → only processes tasks
    - All checked selection → only shows "Uncheck All"
    - All unchecked selection → only shows "Check All"
    - Mixed checked/unchecked → shows both options with counts
    - Toast feedback shows count of tasks processed
