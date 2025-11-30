> [!important]
> My coding knowledge is currently very limited. This plugin was created entirely with AI tools, and I may be limited in my ability to fix any issues.

> [!important]
> This plugin only supports the markdown editor (codemirror 6). The legacy editor is not supported.

# Context Utils

Context Utils is a Joplin plugin that adds context menu options in the markdown editor related to links, images, and code. The context menu options will only appear when applicable (e.g. Copy Code only appears when right clicking inside a Code Block or Inline Code).

## Context Menu Options

**Open Link/Open Resource** - Open external URLs in browser or Joplin resources in default app.

**Copy URL/Copy Path** - Copy URL or resource file path to clipboard.

**Reveal File** - Reveal Joplin resource file in file explorer.

**Copy Code** - Copy code from inline code or code block to clipboard.

**Copy OCR Text** - Copy OCR text from image resources when available.

## Settings

- Each context menu option can be enabled or disabled in the Plugin settings.

- Enable/Disable toast messages.

## Misc Notes

- Most of these context menu options overlap with the ones provided by the Rich Markdown plugin (this plugin provides similar options but as a standalone plugin).

- Options for "Copy Image" and "Resize Image" are intentionally not provided by this plugin, as they are available in my other plugin: https://github.com/bwat47/simple-image-resize
