> [!important]
> My coding knowledge is currently very limited. This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

> [!important]
> This plugin only supports the markdown editor (codemirror 6). The legacy editor is not supported.

# Context Utils

Context Utils is a Joplin plugin that adds context menu options in the markdown editor related to links, images, task lists and code. The context menu options will only appear when applicable (e.g. Copy Code only appears when right clicking inside a Code Block or Inline Code).

## Context Menu Options

**Open Link/Open Resource/Send Email/Open Note** - Open external URLs in browser, open Joplin resources in default app, open mailto: links in default mail client, or open linked note.

**Go to footnote** - Scroll editor to selected footnote.

**Copy URL/Copy Path/Copy Email** - Copy URL or resource file path to clipboard, or copy email address from mailto: link.

**Reveal File** - Reveal Joplin resource file in file explorer.

**Copy Code** - Copy code from inline code or code block to clipboard.

**Copy OCR Text** - Copy OCR text from image resources when available.

**Check/Uncheck Task** - Toggle task on selected line.

**Check/Uncheck All Tasks** - Toggle all tasks in selection.

**Pin to Tabs** - Allows you to right click a link to another joplin note and pin it to a tab (requires the [Note Tabs](https://joplinapp.org/plugins/plugin/joplin.plugin.note.tabs/?from-tab=all) plugin)

**Open in New Window** - Allows you to right click a link to another joplin note and open it in a new window.

## Settings

- Each context menu option can be enabled or disabled in the Plugin settings.

- Enable/Disable toast messages.

## Misc Notes

- Most of these context menu options overlap with the ones provided by the Rich Markdown plugin (this plugin provides similar options but as a standalone plugin).

- Options for "Copy Image" and "Resize Image" are intentionally not provided by this plugin, as they are available in my other plugin: https://github.com/bwat47/simple-image-resize
