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
import { logger } from './logger';

const SECTION_ID = 'contextUtils';
const SETTINGS_CONFIG = {
    showToastMessages: {
        key: `${SECTION_ID}.showToastMessages`,
        defaultValue: true,
        label: 'Show toast notifications',
        description: 'Display brief notification messages for plugin actions (e.g., "Copied to clipboard")',
    },
    showOpenLink: {
        key: `${SECTION_ID}.showOpenLink`,
        defaultValue: true,
        label: 'Show "Open Link" in context menu',
        description:
            'Display option to open external URLs in browser, open Joplin resources in default app, or open selected Note',
    },
    showCopyPath: {
        key: `${SECTION_ID}.showCopyPath`,
        defaultValue: true,
        label: 'Show "Copy Path" in context menu',
        description: 'Display option to copy URL or resource file path to clipboard',
    },
    showRevealFile: {
        key: `${SECTION_ID}.showRevealFile`,
        defaultValue: true,
        label: 'Show "Reveal File" in context menu',
        description: 'Display option to reveal Joplin resource files in file explorer',
    },
    showCopyCode: {
        key: `${SECTION_ID}.showCopyCode`,
        defaultValue: true,
        label: 'Show "Copy Code" in context menu',
        description: 'Display option to copy code from inline code or code blocks to clipboard',
    },
    showCopyOcrText: {
        key: `${SECTION_ID}.showCopyOcrText`,
        defaultValue: true,
        label: 'Show "Copy OCR Text" in context menu',
        description: 'Display option to copy OCR text from image resources when available',
    },
    showToggleTask: {
        key: `${SECTION_ID}.showToggleTask`,
        defaultValue: true,
        label: 'Show task toggle options in context menu',
        description: 'Display options to check/uncheck task list checkboxes ([ ] ↔ [x])',
    },
    showGoToFootnote: {
        key: `${SECTION_ID}.showGoToFootnote`,
        defaultValue: true,
        label: 'Show "Go to footnote" in context menu',
        description: 'Display option to navigate to footnote definitions',
    },
    showGoToHeading: {
        key: `${SECTION_ID}.showGoToHeading`,
        defaultValue: true,
        label: 'Show "Go to heading" in context menu',
        description: 'Display option to navigate to headings via internal anchor links (#heading)',
    },
    showPinToTabs: {
        key: `${SECTION_ID}.showPinToTabs`,
        defaultValue: true,
        label: 'Show "Open Note as Pinned Tab" in context menu',
        description: 'Display option to open notes as a pinned tab (requires Note Tabs plugin)',
    },
    showOpenNoteNewWindow: {
        key: `${SECTION_ID}.showOpenNoteNewWindow`,
        defaultValue: true,
        label: 'Show "Open Note in New Window" in context menu',
        description: 'Display option to open notes in a new window',
    },
} as const;

export type SettingsCache = {
    -readonly [K in keyof typeof SETTINGS_CONFIG]: boolean;
};

/**
 * Module-level settings cache for synchronous access
 */
export const settingsCache = Object.fromEntries(
    Object.entries(SETTINGS_CONFIG).map(([key, config]) => [key, config.defaultValue])
) as SettingsCache;

/**
 * Updates the settings cache by reading all values from Joplin settings
 */
async function updateSettingsCache(): Promise<void> {
    for (const [key, config] of Object.entries(SETTINGS_CONFIG)) {
        settingsCache[key as keyof SettingsCache] = await joplin.settings.value(config.key);
    }
    logger.debug('Settings cache updated:', settingsCache);
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

    logger.debug('Settings cache initialized');
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
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: config.label,
            description: config.description,
        };
    }

    await joplin.settings.registerSettings(settingsSpec);
}
