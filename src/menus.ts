import joplin from 'api';
import { LinkContext, EditorContext, LinkType, COMMAND_IDS } from './types';
import { MenuItem } from 'api/types';
import { logger } from './logger';
import {
    SETTING_SHOW_OPEN_LINK,
    SETTING_SHOW_COPY_PATH,
    SETTING_SHOW_REVEAL_FILE,
    SETTING_SHOW_COPY_CODE,
    SETTING_SHOW_COPY_OCR_TEXT,
} from './settings';
import { extractJoplinResourceId } from './utils/urlUtils';
import { GET_CONTEXT_AT_CURSOR_COMMAND } from './contentScripts/linkDetection';

const CONTENT_SCRIPT_ID = 'contextUtilsLinkDetection';

/**
 * Checks if a Joplin ID is a note (as opposed to a resource/attachment)
 * @param id - The 32-character hex ID
 * @returns true if it's a note, false if it's a resource or doesn't exist
 */
async function isJoplinNote(id: string): Promise<boolean> {
    try {
        // Try to fetch it as a note. If this succeeds, it's a note.
        await joplin.data.get(['notes', id], { fields: ['id'] });
        return true;
    } catch {
        // If it throws (404), it's not a note.
        // It's likely a resource (attachment) or a broken link.
        return false;
    }
}

/**
 * Checks if a resource has OCR text available
 * @param id - The resource ID
 * @returns true if OCR text is available, false otherwise
 */
async function hasOcrText(id: string): Promise<boolean> {
    try {
        const resource = await joplin.data.get(['resources', id], {
            fields: ['ocr_text'],
        });
        return !!resource.ocr_text;
    } catch {
        return false;
    }
}

/**
 * Registers context menu filter
 * This is called BEFORE the context menu opens
 */
export async function registerContextMenuFilter(): Promise<void> {
    await joplin.workspace.filterEditorContextMenu(async (menuItems) => {
        try {
            // Get context directly from editor (pull architecture)
            // This is guaranteed to match the current cursor position
            const context = (await joplin.commands.execute('editor.execCommand', {
                name: GET_CONTEXT_AT_CURSOR_COMMAND,
            })) as EditorContext | null;

            if (!context) {
                // No context at cursor, return menu unchanged
                return menuItems;
            }

            logger.debug('Building context menu for context:', context);

            const contextMenuItems: MenuItem[] = [];

            // Handle different context types
            if (context.contextType === 'link') {
                // Check settings and build menu items for links
                const showOpenLink = await joplin.settings.value(SETTING_SHOW_OPEN_LINK);
                const showCopyPath = await joplin.settings.value(SETTING_SHOW_COPY_PATH);
                const showRevealFile = await joplin.settings.value(SETTING_SHOW_REVEAL_FILE);
                const showCopyOcrText = await joplin.settings.value(SETTING_SHOW_COPY_OCR_TEXT);

                // For Joplin resources, check if it's a note or an actual resource
                let isNote = false;
                let hasOcr = false;
                if (context.type === LinkType.JoplinResource) {
                    const resourceId = extractJoplinResourceId(context.url);
                    isNote = await isJoplinNote(resourceId);
                    // Only check for OCR if it's not a note (i.e., it's a resource)
                    if (!isNote && showCopyOcrText) {
                        hasOcr = await hasOcrText(resourceId);
                    }
                }

                if (showOpenLink) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.OPEN_LINK,
                        commandArgs: [context],
                        label: getLabelForOpenLink(context, isNote),
                    });
                }

                // Only show resource-specific options for actual resources (not notes)
                if (context.type === LinkType.JoplinResource && !isNote) {
                    if (showCopyPath) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.COPY_PATH,
                            commandArgs: [context],
                            label: 'Copy Resource Path',
                        });
                    }

                    if (showRevealFile) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.REVEAL_FILE,
                            commandArgs: [context],
                            label: 'Reveal File in Folder',
                        });
                    }

                    if (hasOcr) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.COPY_OCR_TEXT,
                            commandArgs: [context],
                            label: 'Copy OCR Text',
                        });
                    }
                } else if ((context.type === LinkType.ExternalUrl || context.type === LinkType.Email) && showCopyPath) {
                    // For external URLs and emails, still show copy option
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.COPY_PATH,
                        commandArgs: [context],
                        label: context.type === LinkType.Email ? 'Copy Email Address' : 'Copy URL',
                    });
                }
            } else if (context.contextType === 'code') {
                // Check setting and build menu items for code
                const showCopyCode = await joplin.settings.value(SETTING_SHOW_COPY_CODE);

                if (showCopyCode) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.COPY_CODE,
                        commandArgs: [context],
                        label: 'Copy Code',
                    });
                }
            } else if (context.contextType === 'checkbox') {
                // Add checkbox toggle menu item
                contextMenuItems.push({
                    commandName: COMMAND_IDS.TOGGLE_CHECKBOX,
                    commandArgs: [context],
                    label: context.checked ? 'Uncheck Task' : 'Check Task',
                });
            } else if (context.contextType === 'taskSelection') {
                // Add bulk checkbox menu items for selection
                if (context.uncheckedCount > 0) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.CHECK_ALL_TASKS,
                        commandArgs: [context],
                        label: `Check All Tasks (${context.uncheckedCount})`,
                    });
                }

                if (context.checkedCount > 0) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.UNCHECK_ALL_TASKS,
                        commandArgs: [context],
                        label: `Uncheck All Tasks (${context.checkedCount})`,
                    });
                }
            }

            // Only add items if we have any menu items to show
            if (contextMenuItems.length === 0) {
                return menuItems;
            }

            // Add separator before our items
            const separator: MenuItem = { type: 'separator' };

            // Return original items plus our additions
            return {
                items: [...menuItems.items, separator, ...contextMenuItems],
            };
        } catch (error) {
            logger.error('Error in context menu filter:', error);
            // Return original menu on error to avoid breaking context menu
            return menuItems;
        }
    });
}

/**
 * Generates context-aware label for "Open Link" command
 * @param linkContext - The link context
 * @param isNote - Whether the Joplin resource is a note (only applicable for JoplinResource type)
 */
function getLabelForOpenLink(linkContext: LinkContext, isNote: boolean = false): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Open Link in Browser';
        case LinkType.Email:
            return 'Send Email';
        case LinkType.JoplinResource:
            return isNote ? 'Open Note' : 'Open Resource';
        default:
            return 'Open Link';
    }
}

export { CONTENT_SCRIPT_ID };
