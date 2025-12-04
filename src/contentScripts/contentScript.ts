import { EditorView } from '@codemirror/view';
import type { ContentScriptContext, CodeMirrorWrapper } from '../types';
import { logger } from '../logger';
import { detectContextAtPosition } from './contextDetection';

/**
 * Command name for getting context at cursor
 */
export const GET_CONTEXT_AT_CURSOR_COMMAND = 'contextUtils-getContextAtCursor';

/**
 * Command name for replacing a range of text in the editor
 */
export const REPLACE_RANGE_COMMAND = 'contextUtils-replaceRange';
export const BATCH_REPLACE_COMMAND = 'contextUtils-batchReplace';

/**
 * Content script entry point
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default (_context: ContentScriptContext) => {
    return {
        plugin: (codeMirrorWrapper: CodeMirrorWrapper) => {
            // Check CM6 availability
            if (!codeMirrorWrapper.cm6) {
                logger.warn('CodeMirror 6 not available');
                return;
            }

            const view: EditorView = codeMirrorWrapper.editor as EditorView;

            // Track the position of the last right-click
            // This allows us to get the context at the click location even if the cursor
            // is elsewhere (e.g., when right-clicking inside a text selection)
            let lastRightClickPos: number | null = null;

            view.dom.addEventListener('mousedown', () => {
                // Clear on any click to ensure we don't use stale data
                lastRightClickPos = null;
            });

            view.dom.addEventListener('contextmenu', (event) => {
                // Capture position on context menu event
                // This handles Right Click (all OS), Ctrl+Click (Mac), and Menu Key automatically
                const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos !== null) {
                    lastRightClickPos = pos;
                    logger.debug('Context menu detected at pos:', pos);
                }
            });

            // Clear the tracked position on key press to ensure keyboard navigation
            // resets the context to the cursor
            view.dom.addEventListener('keydown', () => {
                lastRightClickPos = null;
            });

            // Register command to get context at cursor (pull architecture)
            // This is called on-demand when the context menu opens
            codeMirrorWrapper.registerCommand(GET_CONTEXT_AT_CURSOR_COMMAND, () => {
                // Force view to sync/measure before reading cursor position
                view.requestMeasure();

                // Use the position from the last right-click if available and valid,
                // otherwise fall back to the main cursor position.
                let pos = view.state.selection.main.head;
                if (lastRightClickPos !== null && lastRightClickPos <= view.state.doc.length) {
                    pos = lastRightClickPos;
                    logger.debug('Using last right-click position:', pos);
                }

                const context = detectContextAtPosition(view, pos);
                logger.debug('Context detected at position:', pos, context);
                return context;
            });

            // Register command to replace a range of text in the editor
            // Used for checkbox toggling and other text replacement operations
            codeMirrorWrapper.registerCommand(
                REPLACE_RANGE_COMMAND,
                (newText: string, from: number, to: number, expectedText?: string) => {
                    // Validate inputs
                    if (typeof newText !== 'string') {
                        logger.error('replaceRange: newText must be a string');
                        return false;
                    }

                    if (
                        typeof from !== 'number' ||
                        typeof to !== 'number' ||
                        !Number.isFinite(from) ||
                        !Number.isFinite(to)
                    ) {
                        logger.error('replaceRange: from and to must be finite numbers');
                        return false;
                    }

                    if (from > to) {
                        logger.error('replaceRange: from must be <= to');
                        return false;
                    }

                    try {
                        // Optimistic concurrency control: Verify text hasn't changed
                        if (expectedText !== undefined) {
                            const currentText = view.state.doc.sliceString(from, to);
                            if (currentText !== expectedText) {
                                logger.warn(
                                    'replaceRange: Content changed since detection; aborting replacement.',
                                    '\nExpected:',
                                    expectedText,
                                    '\nFound:',
                                    currentText
                                );
                                return false;
                            }
                        }

                        // Perform the text replacement
                        view.dispatch({
                            changes: { from, to, insert: newText },
                        });
                        logger.debug(`Replaced text from ${from} to ${to} with:`, newText);
                        return true;
                    } catch (error) {
                        logger.error('replaceRange: failed to replace text:', error);
                        return false;
                    }
                }
            );

            // Register command to batch replace multiple ranges
            // Used for bulk checkbox toggling
            codeMirrorWrapper.registerCommand(
                BATCH_REPLACE_COMMAND,
                (replacements: Array<{ from: number; to: number; text: string; expectedText?: string }>) => {
                    // Safety Check: Verify all texts match expectation before applying ANY changes
                    for (const r of replacements) {
                        if (r.expectedText !== undefined) {
                            const currentText = view.state.doc.sliceString(r.from, r.to);
                            if (currentText !== r.expectedText) {
                                logger.warn(
                                    `Batch replace aborted: mismatch at ${r.from}`,
                                    '\nExpected:',
                                    r.expectedText,
                                    '\nFound:',
                                    currentText
                                );
                                return false; // Abort entire transaction if document changed
                            }
                        }
                    }

                    const changes = replacements.map((r) => ({
                        from: r.from,
                        to: r.to,
                        insert: r.text,
                    }));

                    try {
                        // ATOMICITY: All changes applied in one transaction
                        // CodeMirror automatically handles the offset shifting
                        view.dispatch({ changes });
                        logger.debug(`Batch replaced ${changes.length} ranges`);
                        return true;
                    } catch (error) {
                        logger.error('batchReplace: failed to replace text:', error);
                        return false;
                    }
                }
            );
        },
    };
};
