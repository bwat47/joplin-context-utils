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
                const pos = view.state.selection.main.head;
                const context = detectContextAtPosition(view, pos);
                logger.debug('Context detected at cursor:', context);
                return context;
            });

            // Register command to replace a range of text in the editor
            // Used for checkbox toggling and other text replacement operations
            codeMirrorWrapper.registerCommand(REPLACE_RANGE_COMMAND, (newText: string, from: number, to: number) => {
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
            });
        },
    };
};
