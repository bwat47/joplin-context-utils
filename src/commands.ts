import joplin from 'api';
import {
    COMMAND_IDS,
    LinkContext,
    CodeContext,
    CheckboxContext,
    TaskSelectionContext,
    LinkType,
    FootnoteContext,
} from './types';
import { showToast, ToastType } from './utils/toastUtils';
import { logger } from './logger';
import { extractJoplinResourceId } from './utils/urlUtils';
import {
    REPLACE_RANGE_COMMAND,
    BATCH_REPLACE_COMMAND,
    SCROLL_TO_POSITION_COMMAND,
} from './contentScripts/contentScript';
import { toggleCheckboxInLine } from './utils/checkboxUtils';

/**
 * Registers all context menu commands
 */
export async function registerCommands(): Promise<void> {
    await joplin.commands.register({
        name: COMMAND_IDS.OPEN_LINK,
        label: 'Open Link',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleOpenLink(linkContext);
            } catch (error) {
                logger.error('Failed to open link:', error);
                await showToast('Failed to open link', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_PATH,
        label: 'Copy Path',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleCopyPath(linkContext);
            } catch (error) {
                logger.error('Failed to copy path:', error);
                await showToast('Failed to copy path', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.REVEAL_FILE,
        label: 'Reveal File in Folder',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleRevealFile(linkContext);
            } catch (error) {
                logger.error('Failed to reveal file:', error);
                await showToast('Failed to reveal file', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_CODE,
        label: 'Copy Code',
        execute: async (codeContext: CodeContext) => {
            try {
                await handleCopyCode(codeContext);
            } catch (error) {
                logger.error('Failed to copy code:', error);
                await showToast('Failed to copy code', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.COPY_OCR_TEXT,
        label: 'Copy OCR Text',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleCopyOcrText(linkContext);
            } catch (error) {
                logger.error('Failed to copy OCR text:', error);
                await showToast('Failed to copy OCR text', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.TOGGLE_CHECKBOX,
        label: 'Toggle Checkbox',
        execute: async (checkboxContext: CheckboxContext) => {
            try {
                await handleToggleCheckbox(checkboxContext);
            } catch (error) {
                logger.error('Failed to toggle checkbox:', error);
                await showToast('Failed to toggle checkbox', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.CHECK_ALL_TASKS,
        label: 'Check All Tasks',
        execute: async (taskSelectionContext: TaskSelectionContext) => {
            try {
                await handleCheckAllTasks(taskSelectionContext);
            } catch (error) {
                logger.error('Failed to check all tasks:', error);
                await showToast('Failed to check all tasks', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.UNCHECK_ALL_TASKS,
        label: 'Uncheck All Tasks',
        execute: async (taskSelectionContext: TaskSelectionContext) => {
            try {
                await handleUncheckAllTasks(taskSelectionContext);
            } catch (error) {
                logger.error('Failed to uncheck all tasks:', error);
                await showToast('Failed to uncheck all tasks', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.GO_TO_FOOTNOTE,
        label: 'Go to footnote',
        execute: async (footnoteContext: FootnoteContext) => {
            try {
                await handleGoToFootnote(footnoteContext);
            } catch (error) {
                logger.error('Failed to go to footnote:', error);
                await showToast('Failed to go to footnote', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.PIN_TO_TABS,
        label: 'Open Note as Pinned Tab',
        execute: async (linkContext: LinkContext) => {
            try {
                await handlePinToTabs(linkContext);
            } catch (error) {
                logger.error('Failed to open note as pinned tab:', error);
                await showToast('Failed to open note as pinned tab (is Note Tabs installed?)', ToastType.Error);
            }
        },
    });

    await joplin.commands.register({
        name: COMMAND_IDS.OPEN_NOTE_NEW_WINDOW,
        label: 'Open Note in New Window',
        execute: async (linkContext: LinkContext) => {
            try {
                await handleOpenNoteNewWindow(linkContext);
            } catch (error) {
                logger.error('Failed to open note in new window:', error);
                await showToast('Failed to open note in new window', ToastType.Error);
            }
        },
    });
}

/**
 * Unified "Open Link" handler
 * - External URLs: Open in browser
 * - Joplin Resources: Open in default app
 */
async function handleOpenLink(linkContext: LinkContext): Promise<void> {
    if (linkContext.type === LinkType.ExternalUrl || linkContext.type === LinkType.Email) {
        // Use Joplin's built-in command to open external URL
        await joplin.commands.execute('openItem', linkContext.url);
        logger.info('Opened external URL:', linkContext.url);
    } else if (linkContext.type === LinkType.JoplinResource) {
        // Joplin's openItem command can handle resource links directly
        await joplin.commands.execute('openItem', linkContext.url);
        logger.info('Opened resource:', linkContext.url);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }
}

/**
 * Unified "Copy Path" handler
 * - External URLs: Copy URL to clipboard
 * - Joplin Resources: Copy file path to clipboard
 */
async function handleCopyPath(linkContext: LinkContext): Promise<void> {
    let textToCopy: string;

    if (linkContext.type === LinkType.ExternalUrl) {
        textToCopy = linkContext.url;
        logger.info('Copying URL to clipboard:', textToCopy);
    } else if (linkContext.type === LinkType.Email) {
        textToCopy = linkContext.url.replace(/^mailto:/i, '');
        logger.info('Copying email to clipboard:', textToCopy);
    } else if (linkContext.type === LinkType.JoplinResource) {
        const resourceId = extractJoplinResourceId(linkContext.url);
        textToCopy = await joplin.data.resourcePath(resourceId);
        logger.info('Copying resource path to clipboard:', textToCopy);
    } else {
        throw new Error(`Unsupported link type: ${linkContext.type}`);
    }

    await joplin.clipboard.writeText(textToCopy);
    await showToast('Copied to clipboard', ToastType.Success);
}

/**
 * "Reveal File in Folder" handler (resources only)
 */
async function handleRevealFile(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Reveal file only works for Joplin resources');
    }

    const resourceId = extractJoplinResourceId(linkContext.url);

    // Use Joplin's built-in revealResourceFile command
    await joplin.commands.execute('revealResourceFile', resourceId);
    logger.info('Revealed resource file:', resourceId);
}

/**
 * "Copy Code" handler
 * Copies code content to clipboard
 */
async function handleCopyCode(codeContext: CodeContext): Promise<void> {
    await joplin.clipboard.writeText(codeContext.code);
    await showToast('Code copied to clipboard', ToastType.Success);
    logger.info('Copied code to clipboard');
}

/**
 * "Copy OCR Text" handler
 * Copies OCR text from image resources to clipboard
 */
async function handleCopyOcrText(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Copy OCR text only works for Joplin resources');
    }

    const resourceId = extractJoplinResourceId(linkContext.url);

    // Fetch the resource with OCR fields
    const resource = await joplin.data.get(['resources', resourceId], {
        fields: ['id', 'mime', 'ocr_text', 'ocr_status'],
    });

    if (!resource.ocr_text) {
        await showToast('No OCR text available for this image', ToastType.Error);
        logger.warn('No OCR text available for resource:', resourceId);
        return;
    }

    await joplin.clipboard.writeText(resource.ocr_text);
    await showToast('OCR text copied to clipboard', ToastType.Success);
    logger.info('Copied OCR text to clipboard for resource:', resourceId);
}

/**
 * "Toggle Checkbox" handler
 * Toggles task list checkbox between [ ] and [x]
 */
async function handleToggleCheckbox(checkboxContext: CheckboxContext): Promise<void> {
    // Toggle the checkbox: [ ] ↔ [x]
    const newLineText = toggleCheckboxInLine(checkboxContext.lineText, !checkboxContext.checked);

    // Replace the line text using the replaceRange command
    const success = (await joplin.commands.execute('editor.execCommand', {
        name: REPLACE_RANGE_COMMAND,
        args: [newLineText, checkboxContext.from, checkboxContext.to, checkboxContext.lineText],
    })) as boolean;

    if (!success) {
        throw new Error('Failed to replace checkbox text');
    }

    const action = checkboxContext.checked ? 'unchecked' : 'checked';
    await showToast(`Task ${action}`, ToastType.Success);
    logger.info(`Toggled checkbox: ${action}`);
}

/**
 * Bulk update tasks handler
 * Used by both Check All and Uncheck All commands
 */
async function handleBulkTaskUpdate(taskSelectionContext: TaskSelectionContext, setChecked: boolean): Promise<void> {
    // Filter to only the tasks that need changing
    const tasksToUpdate = taskSelectionContext.tasks.filter((task) => task.checked !== setChecked);

    if (tasksToUpdate.length === 0) return;

    // Map to the replacement format
    const replacements = tasksToUpdate.map((task) => ({
        from: task.from,
        to: task.to,
        text: toggleCheckboxInLine(task.lineText, setChecked),
        expectedText: task.lineText, // Include for optimistic concurrency check
    }));

    // Send ONE IPC message
    const success = (await joplin.commands.execute('editor.execCommand', {
        name: BATCH_REPLACE_COMMAND,
        args: [replacements],
    })) as boolean;

    const action = setChecked ? 'Checked' : 'Unchecked';
    if (success) {
        await showToast(
            `${action} ${replacements.length} task${replacements.length !== 1 ? 's' : ''}`,
            ToastType.Success
        );
        logger.info(`${action} ${replacements.length} tasks`);
    } else {
        await showToast('Content changed; update aborted', ToastType.Error);
        logger.warn('Batch update aborted due to content mismatch');
    }
}

/**
 * "Check All Tasks" handler
 */
async function handleCheckAllTasks(taskSelectionContext: TaskSelectionContext): Promise<void> {
    await handleBulkTaskUpdate(taskSelectionContext, true);
}

/**
 * "Uncheck All Tasks" handler
 */
async function handleUncheckAllTasks(taskSelectionContext: TaskSelectionContext): Promise<void> {
    await handleBulkTaskUpdate(taskSelectionContext, false);
}

/**
 * "Go to footnote" handler
 */
async function handleGoToFootnote(footnoteContext: FootnoteContext): Promise<void> {
    await joplin.commands.execute('editor.execCommand', {
        name: SCROLL_TO_POSITION_COMMAND,
        args: [footnoteContext.targetPos],
    });
    logger.info('Scrolled to footnote definition:', footnoteContext.label);
}

/**
 * "Pin to Tabs" handler
 * Calls the Note Tabs plugin's tabsPinNote command
 */
async function handlePinToTabs(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Pin to tabs only works for Joplin note links');
    }

    const noteId = extractJoplinResourceId(linkContext.url);
    // Call the Note Tabs plugin command with the array signature it expects
    await joplin.commands.execute('tabsPinNote', [noteId]);
    logger.info('Pinned note to tabs:', noteId);
}

/**
 * "Open in New Window" handler
 * Opens the note in a new Joplin window
 */
async function handleOpenNoteNewWindow(linkContext: LinkContext): Promise<void> {
    if (linkContext.type !== LinkType.JoplinResource) {
        throw new Error('Open in new window only works for Joplin note links');
    }

    const noteId = extractJoplinResourceId(linkContext.url);
    await joplin.commands.execute('openNoteInNewWindow', noteId);
    logger.info('Opened note in new window:', noteId);
}
