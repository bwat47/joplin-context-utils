/**
 * Shared contract between the markdown viewer and the editor for toggling
 * tasks selected in the viewer.
 *
 * Joplin's renderer stamps each task list item with `source-line`, the 0-based
 * Markdown line it was rendered from. The viewer script reports the task items
 * a right-click's text selection covers, and the editor resolves those lines
 * to tasks in the note source.
 *
 * Kept runtime dependency-free so the plugin and the CodeMirror content script
 * can both import it.
 *
 * `src/contentScripts/viewerContextMenu.js` runs as a plain script in the
 * viewer and cannot import this module, so it repeats the content script ID.
 * Keep them in sync.
 */

export const VIEWER_CONTENT_SCRIPT_ID = 'contextUtilsViewerTasks';

/**
 * A task item selected in the viewer.
 *
 * - `line`: 0-based Markdown source line of the task.
 * - `checked`: checkbox state the viewer rendered, used to detect a viewer
 *   render that no longer matches the note source.
 */
export interface ViewerTask {
    line: number;
    checked: boolean;
}

const isViewerTask = (value: unknown): value is ViewerTask => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<ViewerTask>;
    return (
        typeof candidate.line === 'number' &&
        Number.isInteger(candidate.line) &&
        candidate.line >= 0 &&
        typeof candidate.checked === 'boolean'
    );
};

/**
 * Validate a task list received across the viewer/plugin/editor boundary.
 *
 * Takes `unknown` because the value arrives as plain data from a webview.
 */
export function isViewerTaskList(value: unknown): value is ViewerTask[] {
    return Array.isArray(value) && value.length > 0 && value.every(isViewerTask);
}
