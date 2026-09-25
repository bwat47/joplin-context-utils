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
    if (window.contextUtilsViewerContextMenuLoaded) return;
    window.contextUtilsViewerContextMenuLoaded = true;

    const CONTENT_SCRIPT_ID = 'contextUtilsViewerTasks';

    /**
     * True when the selection range covers some text of the element.
     * Touching the element's boundary (for example a triple-click selection
     * that ends at the start of the next item) does not count.
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

    const findSelectedTasks = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return null;

        const tasks = [];
        for (const item of document.querySelectorAll('li.md-checkbox[source-line]')) {
            const line = item.getAttribute('source-line');
            // The item's own checkbox comes before any nested task list.
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (!checkbox || !/^\d+$/.test(line)) continue;

            // Test the checkbox's wrapper (checkbox + label), not the whole item:
            // a parent item contains its nested list, which is selected on its own.
            const ownContent = checkbox.parentElement === item ? checkbox : checkbox.parentElement;
            for (let i = 0; i < selection.rangeCount; i++) {
                if (selectsTextIn(selection.getRangeAt(i), ownContent)) {
                    tasks.push({ line: Number(line), checked: checkbox.checked });
                    break;
                }
            }
        }
        return tasks.length > 0 ? tasks : null;
    };

    // Capture phase, so the message is sent before Joplin's own viewer
    // handler asks the app to open its context menu.
    document.addEventListener(
        'contextmenu',
        () => {
            let tasks = null;
            try {
                tasks = findSelectedTasks();
            } catch (error) {
                console.warn('[Context Utils] Could not read viewer task selection:', error);
            }
            webviewApi.postMessage(CONTENT_SCRIPT_ID, { tasks, clickedAt: Date.now() }).catch((error) => {
                console.warn('[Context Utils] Could not report viewer context menu tasks:', error);
            });
        },
        true
    );
})();
