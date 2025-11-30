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
- Uses syntax tree traversal (NOT regex) for detection
- Priority: Code > Links > Images > HTML
- Exports detection logic and context comparison

### Utilities

**src/utils/logger.ts**

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

### 2. Syntax Tree Traversal (NOT Regex)

**Bad (fragile):**

```typescript
const match = linkText.match(/\[([^\]]+)\]\(([^)]+)\)/);
// Breaks on nested parentheses: [text](https://example.com/foo(bar))
```

**Good (robust):**

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

## Important Notes

### CodeMirror 6 Syntax Nodes

**Markdown:**

- `Link` - `[text](url)` (entire structure)
- `Image` - `![alt](url)` (entire structure)
- `URL` - Bare URLs or child nodes of Link/Image
- `Autolink` - `<url>`
- `InlineCode` / `CodeText` - `` `code` ``
- `FencedCode` / `CodeBlock` - ` ` ```

**HTML in Markdown:**

- `HTMLTag` - Entire tag (no internal structure)
- Must use regex for `<img src="...">` parsing (acceptable here)

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
- Test with both Joplin resources and external URLs
