// @ts-check
/**
 * Markdown viewer asset: reports the task items selected at a right-click.
 *
 * Loaded as a plain script by viewerContentScript.ts, so it cannot import
 * shared modules. The content script ID below must match src/viewerTasks.ts.
 *
 * Every right-click in the viewer posts its click time and the selected tasks,
 * or null when the selection covers no task text. That gives the context menu
 * filter a definitive answer for each right-click. Joplin's viewer only opens a
 * context menu over a text selection (or a link or resource), so tasks are
 * only ever toggled from a selection.
 */
(function () {
    const viewerWindow = /** @type {import('./viewerContextMenuTypes').ViewerWindow} */ (window);
    if (viewerWindow.contextUtilsViewerContextMenuLoaded) return;
    viewerWindow.contextUtilsViewerContextMenuLoaded = true;

    const CONTENT_SCRIPT_ID = 'contextUtilsViewerTasks';

    /* oxlint-disable unicorn/consistent-function-scoping -- Plain script; the IIFE keeps helpers out of the viewer's global scope. */

    /**
     * True when the selection range covers some text of the element.
     * Touching the element's boundary (for example a triple-click selection
     * that ends at the start of the next item) does not count.
     * @param {Range} range
     * @param {Node} element
     */
    const selectsTextIn = (range, element) => {
        const overlap = document.createRange();
        overlap.selectNodeContents(element);
        if (range.compareBoundaryPoints(Range.START_TO_START, overlap) > 0) {
            overlap.setStart(range.startContainer, range.startOffset);
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, overlap) < 0) {
            overlap.setEnd(range.endContainer, range.endOffset);
        }
        return !overlap.collapsed && overlap.toString().length > 0;
    };

    /**
     * True when any range of the selection covers some text of the element.
     * @param {Selection} selection
     * @param {Node} element
     */
    const selectionCoversTextIn = (selection, element) => {
        for (let i = 0; i < selection.rangeCount; i++) {
            if (selectsTextIn(selection.getRangeAt(i), element)) return true;
        }
        return false;
    };

    /**
     * The task for a checkbox list item when the selection covers the item's own text.
     * @param {Element} item
     * @param {Selection} selection
     * @returns {import('../../viewerTasks').ViewerTask | null}
     */
    const getSelectedTask = (item, selection) => {
        if (!(item instanceof HTMLElement)) return null;
        const line = item.getAttribute('source-line');
        // The item's own checkbox comes before any nested task list.
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!(checkbox instanceof HTMLInputElement) || !checkbox.parentElement || line === null || !/^\d+$/.test(line))
            return null;

        // Test the checkbox's wrapper (checkbox + label), not the whole item:
        // a parent item contains its nested list, which is selected on its own.
        const ownContent = checkbox.parentElement === item ? checkbox : checkbox.parentElement;
        return selectionCoversTextIn(selection, ownContent) ? { line: Number(line), checked: checkbox.checked } : null;
    };

    /* oxlint-enable unicorn/consistent-function-scoping */

    const findSelectedTasks = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return null;

        /** @type {import('../../viewerTasks').ViewerTask[]} */
        const tasks = [];
        for (const item of document.querySelectorAll('li.md-checkbox[source-line]')) {
            const task = getSelectedTask(item, selection);
            if (task) tasks.push(task);
        }
        return tasks.length > 0 ? tasks : null;
    };

    // Capture phase, so the message is sent before Joplin's own viewer
    // handler asks the app to open its context menu.
    document.addEventListener(
        'contextmenu',
        () => {
            // Joplin injects a lexical global, which need not be a window property.
            /** @type {unknown} */
            const hostApi =
                // @ts-expect-error This name exists only in Joplin's viewer runtime.
                typeof webviewApi === 'undefined' ? undefined : webviewApi;
            const viewerApi = /** @type {import('./viewerContextMenuTypes').ViewerWebviewApi | undefined} */ (hostApi);
            if (!viewerApi || typeof viewerApi.postMessage !== 'function') return;

            /** @type {import('../../viewerTasks').ViewerTask[] | null} */
            let tasks = null;
            try {
                tasks = findSelectedTasks();
            } catch (error) {
                console.warn('[Context Utils] Could not read viewer task selection:', error);
            }
            viewerApi.postMessage(CONTENT_SCRIPT_ID, { tasks, clickedAt: Date.now() }).catch((error) => {
                console.warn('[Context Utils] Could not report viewer context menu tasks:', error);
            });
        },
        true
    );
})();
