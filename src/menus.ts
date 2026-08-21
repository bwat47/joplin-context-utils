import joplin from 'api';
import { LinkContext, EditorContext, LinkType, COMMAND_IDS } from './types';
import { MenuItem, MenuItemLocation } from 'api/types';
import { logger } from './logger';
import { extractJoplinResourceId } from './utils/urlUtils';
import { getTaskToggleMenuLabel } from './utils/taskToggleUtils';
import { isFetchableLink, linkContextToLinkInfo, getFetchLinkTitlesMenuLabel } from './utils/linkTitleUtils';
import { GET_CONTEXT_AT_CURSOR_COMMAND, IS_EDITOR_CONTEXT_MENU_ORIGIN_COMMAND } from './contentScripts/contentScript';
import { settingsCache } from './settings';

const CONTENT_SCRIPT_ID = 'contextUtilsLinkDetection';
const TOGGLE_TASK_EDIT_MENU_ITEM_ID = 'contextUtilsToggleTaskEditMenuItem';
const CONTEXTUAL_COPY_EDIT_MENU_ITEM_ID = 'contextUtilsContextualCopyEditMenuItem';
const FETCH_LINK_TITLES_EDIT_MENU_ITEM_ID = 'contextUtilsFetchLinkTitlesEditMenuItem';
const TOGGLE_TASK_ACCELERATOR = 'CmdOrCtrl+Shift+Space';
const CONTEXTUAL_COPY_ACCELERATOR = 'CmdOrCtrl+Shift+X';

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
 * Checks if the current context menu invocation originated from the markdown editor.
 * Returns false for markdown viewer and other non-editor surfaces.
 */
async function isEditorContextMenuOrigin(): Promise<boolean> {
    try {
        const result = await joplin.commands.execute('editor.execCommand', {
            name: IS_EDITOR_CONTEXT_MENU_ORIGIN_COMMAND,
        });
        return result === true;
    } catch (error) {
        logger.debug('Editor context menu origin check failed:', error);
        return false;
    }
}

function buildGlobalMenuItems(): MenuItem[] {
    const items: MenuItem[] = [];

    if (settingsCache.showAddExternalLink) {
        items.push({
            commandName: COMMAND_IDS.ADD_EXTERNAL_LINK,
            label: 'Add External Link',
        });
    }

    if (settingsCache.showAddLinkToNote) {
        items.push({
            commandName: COMMAND_IDS.ADD_LINK_TO_NOTE,
            label: 'Add Link to Note',
        });
    }

    return items;
}

function hasEnabledContextSensitiveItem(): boolean {
    // Keep this list in sync with the context-specific menu builders below.
    return (
        settingsCache.showOpenLink ||
        settingsCache.showPinToTabs ||
        settingsCache.showCopyPath ||
        settingsCache.showCopyCode ||
        settingsCache.showToggleTask ||
        settingsCache.showGoToFootnote ||
        settingsCache.showGoToHeading ||
        settingsCache.showFetchLinkTitle ||
        settingsCache.showOpenAllLinksInSelection ||
        settingsCache.showCopyHeadingLink ||
        settingsCache.showCopyQuote
    );
}

async function getEditorContexts(): Promise<EditorContext[]> {
    if (!hasEnabledContextSensitiveItem()) {
        return [];
    }

    try {
        const result = await joplin.commands.execute('editor.execCommand', {
            name: GET_CONTEXT_AT_CURSOR_COMMAND,
        });

        return (Array.isArray(result) ? result : []) as EditorContext[];
    } catch (error) {
        logger.error('Error getting contexts at cursor:', error);
        return [];
    }
}

async function buildLinkMenuItems(context: LinkContext): Promise<MenuItem[]> {
    const items: MenuItem[] = [];
    const isExternalOrEmail = context.type === LinkType.ExternalUrl || context.type === LinkType.Email;
    let isNote = false;

    if (context.type === LinkType.JoplinResource && settingsCache.showPinToTabs) {
        const resourceId = extractJoplinResourceId(context.url);
        isNote = (await getJoplinIdType(resourceId)) === 'note';
    }

    if (settingsCache.showOpenLink && isExternalOrEmail) {
        items.push({
            commandName: COMMAND_IDS.OPEN_LINK,
            commandArgs: [context],
            label: getLabelForOpenLink(context),
        });
    }

    // If Note Tabs isn't installed, command execution will show an error toast.
    if (isNote) {
        items.push({
            commandName: COMMAND_IDS.PIN_TO_TABS,
            commandArgs: [context],
            label: 'Open Note as Pinned Tab',
        });
    }

    if (settingsCache.showCopyPath && isExternalOrEmail) {
        items.push({
            commandName: COMMAND_IDS.COPY_PATH,
            commandArgs: [context],
            label: context.type === LinkType.Email ? 'Copy Email Address' : 'Copy URL',
        });
    }

    if (settingsCache.showFetchLinkTitle && isFetchableLink(context)) {
        items.push({
            commandName: COMMAND_IDS.FETCH_LINK_TITLES,
            commandArgs: [[linkContextToLinkInfo(context)]],
            label: getFetchLinkTitlesMenuLabel(1),
        });
    }

    if (context.type === LinkType.InternalAnchor && settingsCache.showGoToHeading) {
        items.push({
            commandName: COMMAND_IDS.GO_TO_HEADING,
            commandArgs: [context],
            label: 'Go to Heading',
        });
    }

    return items;
}

function buildHeadingMenuItems(context: Extract<EditorContext, { contextType: 'heading' }>): MenuItem[] {
    if (!settingsCache.showCopyHeadingLink) {
        return [];
    }

    return [
        {
            commandName: COMMAND_IDS.COPY_HEADING_LINK_INTERNAL,
            commandArgs: [context],
            label: 'Copy Heading Link (internal)',
        },
        {
            commandName: COMMAND_IDS.COPY_HEADING_LINK_EXTERNAL,
            commandArgs: [context],
            label: 'Copy Heading Link (external)',
        },
    ];
}

function buildLinkSelectionMenuItems(context: Extract<EditorContext, { contextType: 'linkSelection' }>): MenuItem[] {
    const items: MenuItem[] = [];

    if (settingsCache.showOpenAllLinksInSelection) {
        items.push({
            commandName: COMMAND_IDS.OPEN_ALL_LINKS_IN_SELECTION,
            commandArgs: [context],
            label: `Open All Links (${context.links.length})`,
        });
    }

    if (settingsCache.showFetchLinkTitle) {
        items.push({
            commandName: COMMAND_IDS.FETCH_LINK_TITLES,
            commandArgs: [context.links],
            label: getFetchLinkTitlesMenuLabel(context.links.length),
        });
    }

    return items;
}

async function buildMenuItemsForContext(context: EditorContext): Promise<MenuItem[]> {
    switch (context.contextType) {
        case 'link':
            return buildLinkMenuItems(context);
        case 'code':
            return settingsCache.showCopyCode
                ? [{ commandName: COMMAND_IDS.COPY_CODE, commandArgs: [context], label: 'Copy Code' }]
                : [];
        case 'task':
            return settingsCache.showToggleTask
                ? [
                      {
                          commandName: COMMAND_IDS.TOGGLE_CHECKBOX,
                          commandArgs: [context],
                          label: getLabelForTaskToggle(context),
                      },
                  ]
                : [];
        case 'footnote':
            return settingsCache.showGoToFootnote
                ? [
                      {
                          commandName: COMMAND_IDS.GO_TO_FOOTNOTE,
                          commandArgs: [context],
                          label: 'Go to Footnote',
                      },
                  ]
                : [];
        case 'heading':
            return buildHeadingMenuItems(context);
        case 'quote':
            return settingsCache.showCopyQuote
                ? [{ commandName: COMMAND_IDS.COPY_QUOTE, commandArgs: [context], label: 'Copy Quote' }]
                : [];
        case 'linkSelection':
            return buildLinkSelectionMenuItems(context);
        default:
            context satisfies never;
            return [];
    }
}

async function buildContextSensitiveMenuItems(contexts: EditorContext[]): Promise<MenuItem[]> {
    const items: MenuItem[] = [];

    for (const context of contexts) {
        items.push(...(await buildMenuItemsForContext(context)));
    }

    return items;
}

function combineMenuItems(contextItems: MenuItem[], globalItems: MenuItem[]): MenuItem[] {
    if (contextItems.length === 0) {
        return globalItems;
    }

    if (globalItems.length === 0) {
        return contextItems;
    }

    return [...contextItems, { type: 'separator' }, ...globalItems];
}

/**
 * Registers context menu filter
 * This is called BEFORE the context menu opens
 */
export function registerContextMenuFilter(): void {
    joplin.workspace.filterEditorContextMenu(async (menuItems) => {
        try {
            // Skip all plugin menu items when the context menu did not originate from the editor
            // (for example, right-clicking in the markdown viewer pane).
            const editorOrigin = await isEditorContextMenuOrigin();
            if (!editorOrigin) {
                return menuItems;
            }

            const globalItems = buildGlobalMenuItems();
            const contexts = await getEditorContexts();
            logger.debug('Building context menu for contexts:', contexts);

            const contextSensitiveItems = await buildContextSensitiveMenuItems(contexts);
            const finalContextItems = combineMenuItems(contextSensitiveItems, globalItems);

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
            // Return original menu on error to avoid breaking context menu.
            return menuItems;
        }
    });
}

export async function registerApplicationMenuItems(): Promise<void> {
    await joplin.views.menuItems.create(
        CONTEXTUAL_COPY_EDIT_MENU_ITEM_ID,
        COMMAND_IDS.CONTEXTUAL_COPY,
        MenuItemLocation.Edit,
        {
            accelerator: CONTEXTUAL_COPY_ACCELERATOR,
        }
    );

    await joplin.views.menuItems.create(
        TOGGLE_TASK_EDIT_MENU_ITEM_ID,
        COMMAND_IDS.TOGGLE_CHECKBOX,
        MenuItemLocation.Edit,
        {
            accelerator: TOGGLE_TASK_ACCELERATOR,
        }
    );

    await joplin.views.menuItems.create(
        FETCH_LINK_TITLES_EDIT_MENU_ITEM_ID,
        COMMAND_IDS.FETCH_LINK_TITLES,
        MenuItemLocation.Edit
    );
}

/**
 * Generates context-aware label for "Open Link" command
 * @param linkContext - The link context
 */
function getLabelForOpenLink(linkContext: LinkContext): string {
    switch (linkContext.type) {
        case LinkType.ExternalUrl:
            return 'Open Link in Browser';
        case LinkType.Email:
            return 'Send Email';
        default:
            return 'Open Link';
    }
}

function getLabelForTaskToggle(context: Extract<EditorContext, { contextType: 'task' }>): string {
    return getTaskToggleMenuLabel(context.tasks);
}

export { CONTENT_SCRIPT_ID };
