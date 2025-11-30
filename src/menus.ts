import joplin from 'api';
import { LinkContext, EditorContext, LinkType, COMMAND_IDS, MESSAGE_TYPES, ContentScriptMessage } from './types';
import { MenuItem } from 'api/types';
import { logger } from './logger';
import {
    SETTING_SHOW_OPEN_LINK,
    SETTING_SHOW_COPY_PATH,
    SETTING_SHOW_REVEAL_FILE,
    SETTING_SHOW_COPY_CODE,
} from './settings';

const CONTENT_SCRIPT_ID = 'contextUtilsLinkDetection';

// Store the current context received from content script
let currentContext: EditorContext | null = null;

/**
 * Sets up message listener for content script updates
 */
export async function setupMessageListener(): Promise<void> {
    await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: ContentScriptMessage) => {
        if (message.type === MESSAGE_TYPES.GET_CONTEXT) {
            currentContext = message.data;
            logger.debug('Editor context updated:', currentContext);
        }
    });
}

/**
 * Registers context menu filter
 * This is called BEFORE the context menu opens
 */
export async function registerContextMenuFilter(): Promise<void> {
    await joplin.workspace.filterEditorContextMenu(async (menuItems) => {
        try {
            // Use the stored context from content script
            const context = currentContext;

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

                if (showOpenLink) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.OPEN_LINK,
                        commandArgs: [context],
                        label: getLabelForOpenLink(context),
                    });
                }

                if (showCopyPath) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.COPY_PATH,
                        commandArgs: [context],
                        label: getLabelForCopyPath(context),
                    });
                }

                // Add "Reveal File" only for Joplin resources
                if (showRevealFile && context.type === LinkType.JoplinResource) {
                    contextMenuItems.push({
                        commandName: COMMAND_IDS.REVEAL_FILE,
                        commandArgs: [context],
                        label: 'Reveal File in Folder',
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
 */
function getLabelForOpenLink(linkContext: LinkContext): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Open Link in Browser';
        case LinkType.JoplinResource:
            return 'Open Resource';
        default:
            return 'Open Link';
    }
}

/**
 * Generates context-aware label for "Copy Path" command
 */
function getLabelForCopyPath(linkContext: LinkContext): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Copy URL';
        case LinkType.JoplinResource:
            return 'Copy Resource Path';
        default:
            return 'Copy Path';
    }
}

export { CONTENT_SCRIPT_ID };
