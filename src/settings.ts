/**
 * Joplin settings registration for Context Utils plugin.
 *
 * Integrates plugin configuration into Joplin's preferences UI, allowing
 * users to customize plugin behavior through Settings > Context Utils.
 *
 * Also maintains an in-memory settings cache to avoid async reads on every operation.
 */

import joplin from 'api';
import { SettingItem, SettingItemType } from 'api/types';

const SECTION_ID = 'contextUtils';
type SettingConfigEntry<T extends string | boolean> = {
    key: string;
    defaultValue: T;
    type: SettingItemType;
    label: string;
    description: string;
    secure?: boolean;
    isEnum?: boolean;
    options?: Record<string, string>;
};

const SETTINGS_CONFIG = {
    showToastMessages: {
        key: `${SECTION_ID}.showToastMessages`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show toast notifications',
        description: 'Display brief notification messages for plugin actions (e.g., "Copied to clipboard")',
    },
    showOpenLink: {
        key: `${SECTION_ID}.showOpenLink`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Open Link" in context menu',
        description: 'Display option to open external URLs in browser or open email links in your default mail app',
    },
    showFetchLinkTitle: {
        key: `${SECTION_ID}.showFetchLinkTitle`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Fetch Link Title" in context menu',
        description: 'Display option to fetch and insert the title of HTTP(S) links',
    },
    linkPreviewApiKey: {
        key: `${SECTION_ID}.linkPreviewApiKey`,
        defaultValue: '',
        type: SettingItemType.String,
        secure: true,
        label: 'linkpreview.net API key',
        description: 'Optional. If set, linkpreview.net is tried first when fetching link titles.',
    },
    linkTitleRules: {
        key: `${SECTION_ID}.linkTitleRules`,
        defaultValue:
            '[{"pattern":"^https?://(?:[a-z0-9-]+\\\\.)*atlassian\\\\.net/(?:browse|issues)/([A-Z][A-Z0-9]+-\\\\d+)","title":"$1","flags":"i"},{"pattern":"^https?://(?:[a-z0-9-]+\\\\.)*atlassian\\\\.net/issues.*[?&]selectedIssue=([A-Za-z][A-Za-z0-9]+-\\\\d+)","title":"$1","flags":"i"}]',
        type: SettingItemType.String,
        label: 'Custom link title rules (JSON)',
        description:
            'JSON array of {pattern, title, flags?} rules. When a rule\'s regex matches a link URL, "Fetch Link Title" uses its title template ($1..$9 capture groups, $& whole match) instead of fetching the page. The default rule handles Jira issue links. See the README for details.',
    },
    showOpenAllLinksInSelection: {
        key: `${SECTION_ID}.showOpenAllLinksInSelection`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Open All Links" in context menu',
        description: 'Display option to open all HTTP(S) links found in the current selection',
    },
    showAddExternalLink: {
        key: `${SECTION_ID}.showAddExternalLink`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Add External Link" in context menu',
        description: 'Display option to insert a hyperlink at the cursor',
    },
    showAddLinkToNote: {
        key: `${SECTION_ID}.showAddLinkToNote`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Add Link to Note" in context menu',
        description: 'Display option to link to another note at the cursor',
    },
    showCopyPath: {
        key: `${SECTION_ID}.showCopyPath`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Copy URL/Email" in context menu',
        description: 'Display option to copy URL or email address to clipboard',
    },
    showCopyCode: {
        key: `${SECTION_ID}.showCopyCode`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Copy Code" in context menu',
        description: 'Display option to copy code from inline code or code blocks to clipboard',
    },
    showCopyHeadingLink: {
        key: `${SECTION_ID}.showCopyHeadingLink`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Copy Heading Link" in context menu',
        description:
            'Display options to copy a markdown link to the heading at the cursor (internal anchor or external note link)',
    },
    showCopyQuote: {
        key: `${SECTION_ID}.showCopyQuote`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Copy Quote" in context menu',
        description: 'Display option to copy block quote contents without quote markers',
    },
    defaultHeadingCopyMode: {
        key: `${SECTION_ID}.defaultHeadingCopyMode`,
        defaultValue: 'internal',
        type: SettingItemType.String,
        label: 'Default heading copy mode',
        description: 'Choose which heading link format Contextual Copy uses when the cursor is on a heading',
        isEnum: true,
        options: {
            internal: 'Internal anchor link',
            external: 'External note link',
        },
    },
    showToggleTask: {
        key: `${SECTION_ID}.showToggleTask`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show task toggle options in context menu',
        description: 'Display options to check/uncheck task list checkboxes ([ ] ↔ [x])',
    },
    showGoToFootnote: {
        key: `${SECTION_ID}.showGoToFootnote`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Go to Footnote" in context menu',
        description: 'Display option to navigate to footnote definitions',
    },
    showGoToHeading: {
        key: `${SECTION_ID}.showGoToHeading`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Go to Heading" in context menu',
        description: 'Display option to navigate to headings via internal anchor links (#heading)',
    },
    showPinToTabs: {
        key: `${SECTION_ID}.showPinToTabs`,
        defaultValue: true,
        type: SettingItemType.Bool,
        label: 'Show "Open Note as Pinned Tab" in context menu',
        description: 'Display option to open notes as a pinned tab (requires Note Tabs plugin)',
    },
} as const satisfies Record<string, SettingConfigEntry<string | boolean>>;

type WidenSettingValue<T extends string | boolean> = T extends boolean ? boolean : T extends string ? string : never;
type SettingKey = keyof typeof SETTINGS_CONFIG;

export type SettingsCache = {
    -readonly [K in SettingKey]: WidenSettingValue<(typeof SETTINGS_CONFIG)[K]['defaultValue']>;
};

function createSettingsCacheFromDefaults(): SettingsCache {
    return Object.fromEntries(
        Object.entries(SETTINGS_CONFIG).map(([key, config]) => [key, config.defaultValue])
    ) as SettingsCache;
}

/**
 * Module-level settings cache for synchronous access
 */
export const settingsCache = createSettingsCacheFromDefaults();

async function updateSettingCacheValue<K extends SettingKey>(key: K): Promise<void> {
    const config = SETTINGS_CONFIG[key];
    settingsCache[key] = (await joplin.settings.value(config.key)) as SettingsCache[K];
}

/**
 * Updates the settings cache by reading all values from Joplin settings
 */
async function updateSettingsCache(): Promise<void> {
    for (const key of Object.keys(SETTINGS_CONFIG) as SettingKey[]) {
        await updateSettingCacheValue(key);
    }
}

/**
 * Initializes the settings cache and registers change listener.
 * Must be called once during plugin initialization, after registerSettings().
 */
export async function initializeSettingsCache(): Promise<void> {
    // Initial cache population
    await updateSettingsCache();

    // Listen for settings changes and update cache
    joplin.settings.onChange(async (event) => {
        const settingKeys = Object.values(SETTINGS_CONFIG).map((c) => c.key);
        if (event.keys.some((key) => (settingKeys as string[]).includes(key))) {
            await updateSettingsCache();
        }
    });
}

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Context Utils',
        iconName: 'fas fa-mouse-pointer',
    });

    const settingsSpec: Record<string, SettingItem> = {};
    for (const config of Object.values(SETTINGS_CONFIG)) {
        settingsSpec[config.key] = {
            value: config.defaultValue,
            type: config.type,
            section: SECTION_ID,
            public: true,
            label: config.label,
            description: config.description,
            secure: 'secure' in config ? config.secure : undefined,
            isEnum: 'isEnum' in config ? config.isEnum : undefined,
            options: 'options' in config ? config.options : undefined,
        };
    }

    await joplin.settings.registerSettings(settingsSpec);
}
