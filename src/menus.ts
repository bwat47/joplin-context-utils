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
export function registerContextMenuFilter(): void {
    joplin.workspace.filterEditorContextMenu(async (menuItems) => {
        const globalItems: MenuItem[] = [];

        // Always show "Add External Link" if enabled (not context-sensitive)
        if (settingsCache.showAddExternalLink) {
            globalItems.push({
                commandName: COMMAND_IDS.ADD_EXTERNAL_LINK,
                label: 'Add External Link',
            });
        }

        // Always show "Add Link to Note" if enabled (not context-sensitive)
        if (settingsCache.showAddLinkToNote) {
            globalItems.push({
                commandName: COMMAND_IDS.ADD_LINK_TO_NOTE,
                label: 'Add Link to Note',
            });
        }

        try {
            const shouldBuildContextSensitiveItems =
                settingsCache.showOpenLink ||
                settingsCache.showOpenNoteNewWindow ||
                settingsCache.showPinToTabs ||
                settingsCache.showCopyPath ||
                settingsCache.showRevealFile ||
                settingsCache.showCopyCode ||
                settingsCache.showCopyOcrText ||
                settingsCache.showToggleTask ||
                settingsCache.showGoToFootnote ||
                settingsCache.showGoToHeading ||
                settingsCache.showFetchLinkTitle ||
                settingsCache.showOpenAllLinksInSelection;

            // Get contexts directly from editor (pull architecture)
            // This is guaranteed to match the current cursor position
            // May return multiple contexts (e.g., code + checkbox)
            let contexts: EditorContext[] = [];
            if (shouldBuildContextSensitiveItems) {
                try {
                    // Small delay to work around timing issue on Linux where cursor position
                    // may not have updated yet when context menu filter is called
                    await new Promise((resolve) => setTimeout(resolve, 10));

                    const contextsResult = await joplin.commands.execute('editor.execCommand', {
                        name: GET_CONTEXT_AT_CURSOR_COMMAND,
                    });

                    contexts = (Array.isArray(contextsResult) ? contextsResult : []) as EditorContext[];
                } catch (error) {
                    logger.error('Error getting contexts at cursor:', error);
                }
            }

            logger.debug('Building context menu for contexts:', contexts);

            const contextSensitiveItems: MenuItem[] = [];

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
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.OPEN_LINK,
                            commandArgs: [context],
                            label: getLabelForOpenLink(context, isNote),
                        });
                    }

                    // Show "Open Note in New Window" for notes
                    if (isNote && settingsCache.showOpenNoteNewWindow) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.OPEN_NOTE_NEW_WINDOW,
                            commandArgs: [context],
                            label: 'Open Note in New Window',
                        });
                    }

                    // Show "Open Note as Pinned Tab" for notes (requires Note Tabs plugin)
                    // If Note Tabs isn't installed, command execution will show an error toast
                    if (isNote && settingsCache.showPinToTabs) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.PIN_TO_TABS,
                            commandArgs: [context],
                            label: 'Open Note as Pinned Tab',
                        });
                    }

                    // Only show resource-specific options for actual resources (not notes)
                    if (context.type === LinkType.JoplinResource && idType === 'resource') {
                        if (settingsCache.showCopyPath) {
                            contextSensitiveItems.push({
                                commandName: COMMAND_IDS.COPY_PATH,
                                commandArgs: [context],
                                label: 'Copy Resource Path',
                            });
                        }

                        if (settingsCache.showRevealFile) {
                            contextSensitiveItems.push({
                                commandName: COMMAND_IDS.REVEAL_FILE,
                                commandArgs: [context],
                                label: 'Reveal File in Folder',
                            });
                        }

                        if (hasOcr) {
                            contextSensitiveItems.push({
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
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.COPY_PATH,
                            commandArgs: [context],
                            label: context.type === LinkType.Email ? 'Copy Email Address' : 'Copy URL',
                        });
                    }

                    // Show "Fetch Link Title" only for external HTTP(S) URLs (not reference links)
                    if (
                        context.type === LinkType.ExternalUrl &&
                        !context.isReferenceLink &&
                        !context.isImage &&
                        settingsCache.showFetchLinkTitle
                    ) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.FETCH_LINK_TITLE,
                            commandArgs: [context],
                            label: 'Fetch Link Title',
                        });
                    }

                    if (context.type === LinkType.InternalAnchor && settingsCache.showGoToHeading) {
                        // For internal anchor links (#heading), show "Go to heading"
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.GO_TO_HEADING,
                            commandArgs: [context],
                            label: 'Go to Heading',
                        });
                    }
                } else if (context.contextType === 'code') {
                    // Check setting and build menu items for code
                    if (settingsCache.showCopyCode) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.COPY_CODE,
                            commandArgs: [context],
                            label: 'Copy Code',
                        });
                    }
                } else if (context.contextType === 'checkbox') {
                    // Check setting and build menu items for task checkboxes
                    if (settingsCache.showToggleTask) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.TOGGLE_CHECKBOX,
                            commandArgs: [context],
                            label: context.checked ? 'Uncheck Task' : 'Check Task',
                        });
                    }
                } else if (context.contextType === 'taskSelection') {
                    // Check setting and build menu items for task selection
                    if (settingsCache.showToggleTask) {
                        if (context.uncheckedCount > 0) {
                            contextSensitiveItems.push({
                                commandName: COMMAND_IDS.CHECK_ALL_TASKS,
                                commandArgs: [context],
                                label: `Check All Tasks (${context.uncheckedCount})`,
                            });
                        }

                        if (context.checkedCount > 0) {
                            contextSensitiveItems.push({
                                commandName: COMMAND_IDS.UNCHECK_ALL_TASKS,
                                commandArgs: [context],
                                label: `Uncheck All Tasks (${context.checkedCount})`,
                            });
                        }
                    }
                } else if (context.contextType === 'footnote') {
                    if (settingsCache.showGoToFootnote) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.GO_TO_FOOTNOTE,
                            commandArgs: [context],
                            label: 'Go to Footnote',
                        });
                    }
                } else if (context.contextType === 'linkSelection') {
                    if (settingsCache.showOpenAllLinksInSelection) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.OPEN_ALL_LINKS_IN_SELECTION,
                            commandArgs: [context],
                            label: `Open All Links (${context.links.length})`,
                        });
                    }

                    // Check setting and build menu items for link selection (batch title fetch)
                    if (settingsCache.showFetchLinkTitle) {
                        contextSensitiveItems.push({
                            commandName: COMMAND_IDS.FETCH_ALL_LINK_TITLES,
                            commandArgs: [context],
                            label: `Fetch All Link Titles (${context.links.length})`,
                        });
                    }
                }
            }

            // Combine items
            const finalContextItems: MenuItem[] = [...contextSensitiveItems];

            // Add separator if we have both context items and global items
            if (contextSensitiveItems.length > 0 && globalItems.length > 0) {
                finalContextItems.push({ type: 'separator' });
            }

            finalContextItems.push(...globalItems);

            // Only add items if we have any menu items to show
            if (finalContextItems.length === 0) {
                return menuItems;
            }

            // Add separator before our items
            const separator: MenuItem = { type: 'separator' };

            // Return original items plus our additions
            return {
                items: [...menuItems.items, separator, ...finalContextItems],
            };
        } catch (error) {
            logger.error('Error in context menu filter:', error);
            // Return original menu on error to avoid breaking context menu
            // but still show global (non-context-sensitive) items when possible.
            if (globalItems.length === 0) {
                return menuItems;
            }

            const separator: MenuItem = { type: 'separator' };
            return {
                items: [...menuItems.items, separator, ...globalItems],
            };
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
