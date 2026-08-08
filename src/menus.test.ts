import { EditContextMenuFilterObject, FilterHandler, MenuItem } from 'api/types';
import { registerContextMenuFilter } from './menus';
import { settingsCache } from './settings';
import { COMMAND_IDS, EditorContext, LinkType } from './types';
import { GET_CONTEXT_AT_CURSOR_COMMAND, IS_EDITOR_CONTEXT_MENU_ORIGIN_COMMAND } from './contentScripts/contentScript';
import { logger } from './logger';
import { vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    execute: vi.fn(),
    dataGet: vi.fn(),
    filterEditorContextMenu: vi.fn(),
    createMenuItem: vi.fn(),
}));

vi.mock('api', () => ({
    default: {
        commands: { execute: apiMocks.execute },
        data: { get: apiMocks.dataGet },
        workspace: { filterEditorContextMenu: apiMocks.filterEditorContextMenu },
        views: { menuItems: { create: apiMocks.createMenuItem } },
    },
}));

const MENU_SETTING_KEYS = [
    'showOpenLink',
    'showFetchLinkTitle',
    'showOpenAllLinksInSelection',
    'showAddExternalLink',
    'showAddLinkToNote',
    'showCopyPath',
    'showCopyCode',
    'showCopyHeadingLink',
    'showCopyQuote',
    'showToggleTask',
    'showGoToFootnote',
    'showGoToHeading',
    'showPinToTabs',
] as const;

const EXISTING_MENU_ITEM: MenuItem = {
    commandName: 'existing.command',
    label: 'Existing Item',
};

const SIMPLE_CONTEXT_CASES = [
    {
        name: 'code',
        setting: 'showCopyCode',
        context: { contextType: 'code', code: 'const value = 1;', from: 0, to: 16 },
        expectedCommands: [COMMAND_IDS.COPY_CODE],
    },
    {
        name: 'task',
        setting: 'showToggleTask',
        context: {
            contextType: 'task',
            tasks: [{ lineText: '- [ ] Task', checked: false, from: 0, to: 10 }],
            checkedCount: 0,
            uncheckedCount: 1,
        },
        expectedCommands: [COMMAND_IDS.TOGGLE_CHECKBOX],
    },
    {
        name: 'footnote',
        setting: 'showGoToFootnote',
        context: { contextType: 'footnote', label: '1', targetPos: 20, from: 0, to: 4 },
        expectedCommands: [COMMAND_IDS.GO_TO_FOOTNOTE],
    },
    {
        name: 'heading',
        setting: 'showCopyHeadingLink',
        context: { contextType: 'heading', headingText: 'Heading', headingAnchor: 'heading', from: 0, to: 9 },
        expectedCommands: [COMMAND_IDS.COPY_HEADING_LINK_INTERNAL, COMMAND_IDS.COPY_HEADING_LINK_EXTERNAL],
    },
    {
        name: 'quote',
        setting: 'showCopyQuote',
        context: { contextType: 'quote', quoteText: 'Quoted text', from: 0, to: 13 },
        expectedCommands: [COMMAND_IDS.COPY_QUOTE],
    },
    {
        name: 'link selection',
        setting: 'showOpenAllLinksInSelection',
        context: {
            contextType: 'linkSelection',
            links: [{ url: 'https://example.com', type: LinkType.ExternalUrl, from: 0, to: 19 }],
            from: 0,
            to: 19,
        },
        expectedCommands: [COMMAND_IDS.OPEN_ALL_LINKS_IN_SELECTION],
    },
] as const satisfies ReadonlyArray<{
    name: string;
    setting: (typeof MENU_SETTING_KEYS)[number];
    context: EditorContext;
    expectedCommands: readonly string[];
}>;

const LINK_SETTING_CASES = [
    {
        name: 'open link',
        setting: 'showOpenLink',
        context: {
            contextType: 'link',
            url: 'https://example.com',
            type: LinkType.ExternalUrl,
            from: 0,
            to: 19,
            expectedText: 'https://example.com',
        },
        expectedCommand: COMMAND_IDS.OPEN_LINK,
    },
    {
        name: 'copy path',
        setting: 'showCopyPath',
        context: {
            contextType: 'link',
            url: 'https://example.com',
            type: LinkType.ExternalUrl,
            from: 0,
            to: 19,
            expectedText: 'https://example.com',
        },
        expectedCommand: COMMAND_IDS.COPY_PATH,
    },
    {
        name: 'fetch link title',
        setting: 'showFetchLinkTitle',
        context: {
            contextType: 'link',
            url: 'https://example.com',
            type: LinkType.ExternalUrl,
            from: 0,
            to: 19,
            expectedText: 'https://example.com',
        },
        expectedCommand: COMMAND_IDS.FETCH_LINK_TITLES,
    },
    {
        name: 'go to heading',
        setting: 'showGoToHeading',
        context: {
            contextType: 'link',
            url: '#target-heading',
            type: LinkType.InternalAnchor,
            from: 0,
            to: 15,
        },
        expectedCommand: COMMAND_IDS.GO_TO_HEADING,
    },
] as const satisfies ReadonlyArray<{
    name: string;
    setting: (typeof MENU_SETTING_KEYS)[number];
    context: EditorContext;
    expectedCommand: string;
}>;

function disableAllMenuSettings(): void {
    for (const key of MENU_SETTING_KEYS) {
        settingsCache[key] = false;
    }
}

function configureEditorCommands(contexts: EditorContext[], editorOrigin = true): void {
    apiMocks.execute.mockImplementation((_command: string, args: { name: string }) => {
        if (args.name === IS_EDITOR_CONTEXT_MENU_ORIGIN_COMMAND) {
            return Promise.resolve(editorOrigin);
        }
        if (args.name === GET_CONTEXT_AT_CURSOR_COMMAND) {
            return Promise.resolve(contexts);
        }
        return Promise.reject(new Error(`Unexpected editor command: ${args.name}`));
    });
}

function getRegisteredFilter(): FilterHandler<EditContextMenuFilterObject> {
    registerContextMenuFilter();
    expect(apiMocks.filterEditorContextMenu).toHaveBeenCalledOnce();
    return apiMocks.filterEditorContextMenu.mock.calls[0][0] as FilterHandler<EditContextMenuFilterObject>;
}

async function runFilter(
    contexts: EditorContext[],
    menuItems: EditContextMenuFilterObject = { items: [EXISTING_MENU_ITEM] }
): Promise<EditContextMenuFilterObject> {
    configureEditorCommands(contexts);
    return getRegisteredFilter()(menuItems);
}

function menuTokens(menuItems: EditContextMenuFilterObject): Array<string | undefined> {
    return menuItems.items.map((item) => item.commandName ?? item.type);
}

describe('context menu filter', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        disableAllMenuSettings();
    });

    afterEach(() => {
        disableAllMenuSettings();
        vi.restoreAllMocks();
    });

    it.each(SIMPLE_CONTEXT_CASES)('builds enabled $name menu items', async ({ setting, context, expectedCommands }) => {
        settingsCache[setting] = true;

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', ...expectedCommands]);
        expect(result.items.slice(2).map((item) => item.commandArgs)).toEqual(expectedCommands.map(() => [context]));
        expect(apiMocks.execute).toHaveBeenCalledTimes(2);
    });

    it.each(LINK_SETTING_CASES)('builds the enabled $name item', async ({ setting, context, expectedCommand }) => {
        settingsCache[setting] = true;

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', expectedCommand]);
        expect(apiMocks.execute).toHaveBeenCalledTimes(2);
    });

    it('omits disabled context types while building enabled ones', async () => {
        settingsCache.showCopyCode = true;
        const contexts: EditorContext[] = [
            { contextType: 'link', url: 'https://example.com', type: LinkType.ExternalUrl, from: 0, to: 19 },
            { contextType: 'task', tasks: [], checkedCount: 0, uncheckedCount: 0 },
            { contextType: 'footnote', label: '1', targetPos: 20, from: 0, to: 4 },
            { contextType: 'heading', headingText: 'Heading', headingAnchor: 'heading', from: 5, to: 14 },
            { contextType: 'quote', quoteText: 'Quote', from: 15, to: 22 },
            { contextType: 'linkSelection', links: [], from: 23, to: 23 },
            { contextType: 'code', code: 'value', from: 24, to: 29 },
        ];

        const result = await runFilter(contexts);

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', COMMAND_IDS.COPY_CODE]);
    });

    it('skips an unknown context type without dropping valid or global items', async () => {
        settingsCache.showCopyCode = true;
        settingsCache.showAddExternalLink = true;
        const unknownContext = { contextType: 'somethingNew' } as unknown as EditorContext;
        const codeContext: EditorContext = { contextType: 'code', code: 'value', from: 0, to: 5 };

        const result = await runFilter([unknownContext, codeContext]);

        expect(menuTokens(result)).toEqual([
            'existing.command',
            'separator',
            COMMAND_IDS.COPY_CODE,
            'separator',
            COMMAND_IDS.ADD_EXTERNAL_LINK,
        ]);
    });

    it('preserves context order and separates context-sensitive items from global items', async () => {
        settingsCache.showCopyCode = true;
        settingsCache.showCopyHeadingLink = true;
        settingsCache.showAddExternalLink = true;
        settingsCache.showAddLinkToNote = true;
        const contexts: EditorContext[] = [
            { contextType: 'code', code: 'value', from: 0, to: 5 },
            { contextType: 'heading', headingText: 'Heading', headingAnchor: 'heading', from: 6, to: 15 },
        ];

        const result = await runFilter(contexts);

        expect(menuTokens(result)).toEqual([
            'existing.command',
            'separator',
            COMMAND_IDS.COPY_CODE,
            COMMAND_IDS.COPY_HEADING_LINK_INTERNAL,
            COMMAND_IDS.COPY_HEADING_LINK_EXTERNAL,
            'separator',
            COMMAND_IDS.ADD_EXTERNAL_LINK,
            COMMAND_IDS.ADD_LINK_TO_NOTE,
        ]);
    });

    it('skips context detection when only global items are enabled', async () => {
        settingsCache.showAddExternalLink = true;
        configureEditorCommands([]);

        const result = await getRegisteredFilter()({ items: [EXISTING_MENU_ITEM] });

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', COMMAND_IDS.ADD_EXTERNAL_LINK]);
        expect(apiMocks.execute).toHaveBeenCalledOnce();
    });

    it('returns the original menu when no plugin items are enabled', async () => {
        const originalMenu = { items: [EXISTING_MENU_ITEM] };

        const result = await runFilter([], originalMenu);

        expect(result).toBe(originalMenu);
    });

    it('returns the original menu outside the markdown editor', async () => {
        settingsCache.showCopyCode = true;
        const originalMenu = { items: [EXISTING_MENU_ITEM] };
        configureEditorCommands([{ contextType: 'code', code: 'value', from: 0, to: 5 }], false);

        const result = await getRegisteredFilter()(originalMenu);

        expect(result).toBe(originalMenu);
        expect(apiMocks.execute).toHaveBeenCalledOnce();
    });

    it('returns the original menu when the editor-origin check fails', async () => {
        settingsCache.showCopyCode = true;
        const originalMenu = { items: [EXISTING_MENU_ITEM] };
        const error = new Error('Editor unavailable');
        const logSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
        apiMocks.execute.mockRejectedValue(error);

        const result = await getRegisteredFilter()(originalMenu);

        expect(result).toBe(originalMenu);
        expect(logSpy).toHaveBeenCalledWith('Editor context menu origin check failed:', error);
    });

    it('builds external link actions in their established order', async () => {
        settingsCache.showOpenLink = true;
        settingsCache.showCopyPath = true;
        settingsCache.showFetchLinkTitle = true;
        const context: EditorContext = {
            contextType: 'link',
            url: 'https://example.com',
            type: LinkType.ExternalUrl,
            from: 0,
            to: 19,
            markdownLinkFrom: 0,
            markdownLinkTo: 19,
            expectedText: 'https://example.com',
        };

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual([
            'existing.command',
            'separator',
            COMMAND_IDS.OPEN_LINK,
            COMMAND_IDS.COPY_PATH,
            COMMAND_IDS.FETCH_LINK_TITLES,
        ]);
        expect(result.items.slice(2).map((item) => item.label)).toEqual([
            'Open Link in Browser',
            'Copy URL',
            'Fetch Link Title',
        ]);
    });

    it('builds email actions without offering link-title fetching', async () => {
        settingsCache.showOpenLink = true;
        settingsCache.showCopyPath = true;
        settingsCache.showFetchLinkTitle = true;
        const context: EditorContext = {
            contextType: 'link',
            url: 'mailto:user@example.com',
            type: LinkType.Email,
            from: 0,
            to: 23,
        };

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual([
            'existing.command',
            'separator',
            COMMAND_IDS.OPEN_LINK,
            COMMAND_IDS.COPY_PATH,
        ]);
        expect(result.items.slice(2).map((item) => item.label)).toEqual(['Send Email', 'Copy Email Address']);
    });

    it('offers pinning only when a Joplin link resolves to a note', async () => {
        settingsCache.showPinToTabs = true;
        const noteId = 'a'.repeat(32);
        const context: EditorContext = {
            contextType: 'link',
            url: `:/${noteId}`,
            type: LinkType.JoplinResource,
            from: 0,
            to: 34,
        };
        apiMocks.dataGet.mockImplementation(([collection]: string[]) => {
            return collection === 'notes' ? Promise.resolve({ id: noteId }) : Promise.reject(new Error('Not found'));
        });

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', COMMAND_IDS.PIN_TO_TABS]);
        expect(apiMocks.dataGet).toHaveBeenCalledTimes(2);
    });

    it('does not offer pinning when a Joplin link resolves to a resource', async () => {
        settingsCache.showPinToTabs = true;
        const resourceId = 'b'.repeat(32);
        const context: EditorContext = {
            contextType: 'link',
            url: `:/${resourceId}`,
            type: LinkType.JoplinResource,
            from: 0,
            to: 34,
        };
        apiMocks.dataGet.mockImplementation(([collection]: string[]) => {
            return collection === 'resources'
                ? Promise.resolve({ id: resourceId })
                : Promise.reject(new Error('Not found'));
        });

        const originalMenu = { items: [EXISTING_MENU_ITEM] };
        const result = await runFilter([context], originalMenu);

        expect(result).toBe(originalMenu);
        expect(apiMocks.dataGet).toHaveBeenCalledTimes(2);
    });

    it('builds both link-selection actions with the correct counts and order', async () => {
        settingsCache.showOpenAllLinksInSelection = true;
        settingsCache.showFetchLinkTitle = true;
        const context: EditorContext = {
            contextType: 'linkSelection',
            links: [
                { url: 'https://one.example', type: LinkType.ExternalUrl, from: 0, to: 19 },
                { url: 'https://two.example', type: LinkType.ExternalUrl, from: 20, to: 39 },
            ],
            from: 0,
            to: 39,
        };

        const result = await runFilter([context]);

        expect(menuTokens(result)).toEqual([
            'existing.command',
            'separator',
            COMMAND_IDS.OPEN_ALL_LINKS_IN_SELECTION,
            COMMAND_IDS.FETCH_LINK_TITLES,
        ]);
        expect(result.items.slice(2).map((item) => item.label)).toEqual([
            'Open All Links (2)',
            'Fetch Link Titles (2)',
        ]);
    });

    it('falls back to global items when context retrieval fails', async () => {
        settingsCache.showCopyCode = true;
        settingsCache.showAddExternalLink = true;
        const error = new Error('Editor unavailable');
        const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        apiMocks.execute.mockImplementation((_command: string, args: { name: string }) => {
            return args.name === IS_EDITOR_CONTEXT_MENU_ORIGIN_COMMAND ? Promise.resolve(true) : Promise.reject(error);
        });

        const result = await getRegisteredFilter()({ items: [EXISTING_MENU_ITEM] });

        expect(menuTokens(result)).toEqual(['existing.command', 'separator', COMMAND_IDS.ADD_EXTERNAL_LINK]);
        expect(logSpy).toHaveBeenCalledWith('Error getting contexts at cursor:', error);
    });
});
