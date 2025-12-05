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
export const SCROLL_TO_POSITION_COMMAND = 'contextUtils-scrollToPosition';

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

            // Register command to get context at cursor (pull architecture)
            // This is called on-demand when the context menu opens
            codeMirrorWrapper.registerCommand(GET_CONTEXT_AT_CURSOR_COMMAND, () => {
                // Force view to sync/measure before reading cursor position
                // This works around a timing issue on Linux where the view might not
                // have synced with the cursor position update from the right-click event
                // See: https://codemirror.net/docs/ref/#view.EditorView.requestMeasure
                view.requestMeasure();

                const pos = view.state.selection.main.head;
                const context = detectContextAtPosition(view, pos);
                logger.debug('Context detected at cursor:', context);
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

            // Register command to scroll to a specific position
            codeMirrorWrapper.registerCommand(SCROLL_TO_POSITION_COMMAND, (pos: number) => {
                if (typeof pos !== 'number' || !Number.isFinite(pos)) {
                    logger.error('scrollToPosition: pos must be a finite number');
                    return;
                }

                const scrollEffect = EditorView.scrollIntoView(pos, { y: 'nearest' });

                // Initial scroll
                view.dispatch({
                    effects: scrollEffect,
                    selection: { anchor: pos, head: pos },
                });
                view.focus();

                // Retry scroll after a short delay to ensure it settles
                // This is needed because CodeMirror's scrollIntoView can be unreliable
                // especially when images are being rendered in the editor
                setTimeout(() => {
                    view.dispatch({
                        effects: scrollEffect,
                    });
                }, 100);

                logger.debug('Scrolled to position:', pos);
            });
        },
    };
};
