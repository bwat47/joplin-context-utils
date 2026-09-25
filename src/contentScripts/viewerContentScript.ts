/**
 * Markdown-it content script for the markdown viewer.
 *
 * Only loads `viewerContextMenu.js`, which reports the task items selected in
 * the viewer to the plugin. It needs no render changes: Joplin already stamps
 * every task list item with its `source-line`.
 */

export default function (): {
    plugin: () => void;
    assets: () => { name: string }[];
} {
    return {
        plugin: () => {},
        assets: () => [{ name: 'viewerContextMenu.js' }],
    };
}
