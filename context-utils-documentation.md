# Context Utils Plugin - Architecture Documentation

> Internal documentation for LLM reference. Describes plugin architecture, file structure, and key patterns.

## Overview

Joplin plugin that adds context-aware menu options when right-clicking on links, images, and code in the markdown editor. Uses CodeMirror 6 syntax tree for robust detection.

**Supported Contexts:**

- External URLs (`https://...`)
- Joplin resources (`:/32-hex-id`)
- Markdown images (`![alt](url)`)
- HTML images (`<img src="...">`)
- Inline code (`` `code` ``)
- Code blocks (` ` ```)

## Architecture

### Core Components

```
┌─────────────────┐
│   index.ts      │  Plugin entry point
│                 │  - Registers settings
│                 │  - Registers content script
│                 │  - Sets up message listener
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

### Data Flow

1. **Content Script** (linkDetection.ts):
    - Listens to cursor movements via CodeMirror 6 EditorView.updateListener
    - Traverses syntax tree to detect context at cursor position
    - Sends context updates to main plugin via `postMessage()`

2. **Main Plugin** (menus.ts):
    - Receives context via `onMessage()` listener
    - Stores current context in module-level variable
    - Builds context menu dynamically when user right-clicks

3. **Commands** (commands.ts):
    - Execute actions when menu items are clicked
    - Use Joplin API for clipboard, file operations, URL opening

## File Structure

### Core Files

**src/index.ts**

- Plugin registration and initialization
- Coordinates all subsystems
- Initialization order matters (settings → content script → listener → commands → menu)

**src/types.ts**

- Type definitions with discriminated unions
- `EditorContext = LinkContext | CodeContext`
- `LinkType` enum (ExternalUrl, JoplinResource)
- Command IDs and message type constants

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
- Distinguishes between note links and resource links using `isJoplinNote()` helper
- Resource-specific options (Copy Path, Reveal File) only shown for actual resources
- Checks settings before adding menu items
- Only adds separator if ≥1 menu item will be shown
- Stores current context from content script messages

**src/commands.ts**

- Command handlers for:
    - Open Link (external URLs → browser, resources → default app)
    - Copy Path (URLs → clipboard, resources → file path)
    - Reveal File (resources only → file explorer)
    - Copy Code (code blocks → clipboard)
- All commands show toast notifications (if enabled)

**src/contentScripts/linkDetection.ts**

- CodeMirror 6 content script (type: CodeMirrorPlugin)
- Hybrid detection approach:
    - Inline code: Regex (InlineCode nodes are flat/leaf nodes)
    - Fenced code blocks: Syntax tree traversal with regex fallback
    - Links/Images: Syntax tree traversal (robust for nested parentheses)
- Priority: Code > Links > Images > HTML
- Exports detection logic and context comparison

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
type EditorContext = LinkContext | CodeContext;

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

### 3. Efficient Context Comparison

Uses shallow property comparison instead of `JSON.stringify()` for performance:

```typescript
function contextEquals(a: EditorContext | null, b: EditorContext | null): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.contextType !== b.contextType || a.from !== b.from || a.to !== b.to) return false;

    if (a.contextType === 'link' && b.contextType === 'link') {
        return a.url === b.url && a.type === b.type;
    } else if (a.contextType === 'code' && b.contextType === 'code') {
        return a.code === b.code;
    }

    return false;
}
```

Runs on every cursor movement → must be efficient.

### 4. Content Script Communication

**One-way messaging only** (Joplin API limitation):

```typescript
// Content script → Main plugin
context.postMessage({
    type: MESSAGE_TYPES.GET_CONTEXT,
    data: currentContext,
});

// Main plugin receives
await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message) => {
    if (message.type === MESSAGE_TYPES.GET_CONTEXT) {
        currentContext = message.data;
    }
});
```

No request/response pattern - content script publishes, main plugin subscribes.

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
- Test with external URLs
- Test inline code and fenced code blocks (including nested backticks in fenced blocks)
