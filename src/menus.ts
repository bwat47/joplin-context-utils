import joplin from 'api';
import { LinkContext, EditorContext, LinkType, COMMAND_IDS } from './types';
import { MenuItem } from 'api/types';
import { logger } from './logger';
import { extractJoplinResourceId } from './utils/urlUtils';
import { GET_CONTEXT_AT_CURSOR_COMMAND } from './contentScripts/contentScript';
import { settingsCache } from './settings';

const CONTENT_SCRIPT_ID = 'contextUtilsLinkDetection';

/**
 * Determines the type of a Joplin ID (note, resource, or invalid)
 * Uses Promise.any to return as soon as one lookup succeeds
 * @param id - The 32-character hex ID
 * @returns 'note', 'resource', or null if neither exists
 */
async function getJoplinIdType(id: string): Promise<'note' | 'resource' | null> {
    try {
        const { type } = await Promise.any([
            joplin.data.get(['notes', id], { fields: ['id'] }).then(() => ({ type: 'note' as const })),
            joplin.data.get(['resources', id], { fields: ['id'] }).then(() => ({ type: 'resource' as const })),
        ]);
        return type;
    } catch {
        // AggregateError: all promises rejected (ID doesn't exist as note or resource)
        return null;
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
            // Small delay to work around timing issue on Linux where cursor position
            // may not have updated yet when context menu filter is called
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Get contexts directly from editor (pull architecture)
            // This is guaranteed to match the current cursor position
            // May return multiple contexts (e.g., code + checkbox)
            const contexts = (await joplin.commands.execute('editor.execCommand', {
                name: GET_CONTEXT_AT_CURSOR_COMMAND,
            })) as EditorContext[];

            if (!contexts || contexts.length === 0) {
                // No context at cursor, return menu unchanged
                return menuItems;
            }

            logger.debug('Building context menu for contexts:', contexts);

            const contextMenuItems: MenuItem[] = [];

            // Process each context and build menu items
            for (const context of contexts) {
                // Handle different context types
                if (context.contextType === 'link') {
                    // For Joplin resources, check if it's a note or an actual resource
                    let idType: 'note' | 'resource' | null = null;
                    let hasOcr = false;
                    if (context.type === LinkType.JoplinResource) {
                        const resourceId = extractJoplinResourceId(context.url);
                        idType = await getJoplinIdType(resourceId);
                        // Only check for OCR if it's a resource (not a note)
                        if (idType === 'resource' && settingsCache.showCopyOcrText) {
                            hasOcr = await hasOcrText(resourceId);
                        }
                    }

                    const isNote = idType === 'note';

                    // Show "Open Link" for all link types except internal anchors
                    // (internal anchors are handled by "Go to heading" instead)
                    if (settingsCache.showOpenLink && context.type !== LinkType.InternalAnchor) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.OPEN_LINK,
                            commandArgs: [context],
                            label: getLabelForOpenLink(context, isNote),
                        });
                    }

                    // Show "Open Note in New Window" for notes
                    if (isNote && settingsCache.showOpenNoteNewWindow) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.OPEN_NOTE_NEW_WINDOW,
                            commandArgs: [context],
                            label: 'Open Note in New Window',
                        });
                    }

                    // Show "Open Note as Pinned Tab" for notes (requires Note Tabs plugin)
                    // If Note Tabs isn't installed, command execution will show an error toast
                    if (isNote && settingsCache.showPinToTabs) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.PIN_TO_TABS,
                            commandArgs: [context],
                            label: 'Open Note as Pinned Tab',
                        });
                    }

                    // Only show resource-specific options for actual resources (not notes)
                    if (context.type === LinkType.JoplinResource && idType === 'resource') {
                        if (settingsCache.showCopyPath) {
                            contextMenuItems.push({
                                commandName: COMMAND_IDS.COPY_PATH,
                                commandArgs: [context],
                                label: 'Copy Resource Path',
                            });
                        }

                        if (settingsCache.showRevealFile) {
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
                    } else if (
                        (context.type === LinkType.ExternalUrl || context.type === LinkType.Email) &&
                        settingsCache.showCopyPath
                    ) {
                        // For external URLs and emails, still show copy option
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.COPY_PATH,
                            commandArgs: [context],
                            label: context.type === LinkType.Email ? 'Copy Email Address' : 'Copy URL',
                        });
                    } else if (context.type === LinkType.InternalAnchor && settingsCache.showGoToHeading) {
                        // For internal anchor links (#heading), show "Go to heading"
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.GO_TO_HEADING,
                            commandArgs: [context],
                            label: 'Go to heading',
                        });
                    }
                } else if (context.contextType === 'code') {
                    // Check setting and build menu items for code
                    if (settingsCache.showCopyCode) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.COPY_CODE,
                            commandArgs: [context],
                            label: 'Copy Code',
                        });
                    }
                } else if (context.contextType === 'checkbox') {
                    // Check setting and build menu items for task checkboxes
                    if (settingsCache.showToggleTask) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.TOGGLE_CHECKBOX,
                            commandArgs: [context],
                            label: context.checked ? 'Uncheck Task' : 'Check Task',
                        });
                    }
                } else if (context.contextType === 'taskSelection') {
                    // Check setting and build menu items for task selection
                    if (settingsCache.showToggleTask) {
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
                } else if (context.contextType === 'footnote') {
                    if (settingsCache.showGoToFootnote) {
                        contextMenuItems.push({
                            commandName: COMMAND_IDS.GO_TO_FOOTNOTE,
                            commandArgs: [context],
                            label: 'Go to footnote',
                        });
                    }
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
