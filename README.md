> [!note]
> This plugin was created entirely with AI tools.

> [!note]
> This plugin only supports the markdown editor (codemirror 6). The legacy editor is not supported.

# Context Utils

Context Utils is a Joplin plugin that adds various context-sensitive options to the right-click context menu in the Markdown Editor and keyboard commands for toggling task list items and contextual copy.

## Context Menu Options

- **Open Link/Send Email** - Open external URLs in browser or open mailto: links in default mail client.

- **Open All Links** - Opens all detected HTTP(S) links in the current text selection, in selection order.

- **Fetch Link Title** / **Fetch All Link Titles** - Fetches the title of a URL and updates markdown link to include the title (or converts to a markdown link if its a bare URL).
    - Note that this results in an outbound request to fetch the web page title.
    - If a `linkpreview.net` API key is configured in plugin settings, the plugin tries `linkpreview.net` first and falls back to direct page fetching if needed.
    - There's special handling for JIRA links to set the link text to the JIRA issue number (since JIRA issues just set the page title to "Jira"). There's currently no special handling for any other link types.

> [!note]
> Open All Links and Fetch Link Title/Fetch All Link Titles do not support reference-style links or links inside embeds.

- **Add External Link** - Insert a hyperlink at the cursor

- **Add Link to Note** - Insert a link to another note at the cursor

- **Go to Footnote** - Scroll editor to defintion associated with the selected Footnote reference.

- **Go to Heading** - Scroll editor to specified heading when right clicking on internal anchor link (e.g. `[Test](#test)`)

- **Copy URL/Copy Email** - Copy URL to clipboard, or copy email address from mailto: link.

- **Copy Code** - Copy code from inline code or code block to clipboard.

- **Copy Heading Link** - Display options to copy a markdown link to the heading at the cursor (internal anchor or external note link)

- **Copy Quote** - Display option to copy block quote contents without quote markers

- **Toggle Task(s)** - Toggle task on selected line or Toggle all tasks in selection(s).
    - can be assigned a keyboard shortcut (uses `CmdOrCtrl+Shift+Space` by default).

- **Open Note as Pinned Tab** - Allows you to right click a link to another joplin note and pin it to a tab (requires the [Note Tabs](https://joplinapp.org/plugins/plugin/joplin.plugin.note.tabs/?from-tab=all) plugin)

## Contextual Copy

A "Contextual Copy" command is provided that will copy the innermost copyable context as the current cursor position. For example:

- Cursor inside block quote > copies contents of the block quote
- Cursor inside a http(s) URL > copies link
- Cursor inside code block or inline code > copies contents of the inline code/code block
- Mixed scenario (inline code inside a block quote) > copies code if cursor is inside the inline code, otherwise copies the quote contents.

This can be assigned a keyboard shortcut and uses `CmdOrCtrl+Shift+X` by default.

## Settings

- Each context menu option can be enabled or disabled in the Plugin settings.
- Enable/Disable toast messages.
- Optional secure `linkpreview.net` API key setting for link title fetching.
- Default heading format for Contextual Copy (internal or external).

## Misc Notes

- Some of these context menu options overlap with the ones provided by the Rich Markdown plugin. Each option can be toggled on/off to avoid conflicts/duplicate menu items.
