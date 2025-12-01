/**
 * Joplin settings registration for Context Utils plugin.
 *
 * Integrates plugin configuration into Joplin's preferences UI, allowing
 * users to customize plugin behavior through Settings > Context Utils.
 *
 * Also maintains an in-memory settings cache to avoid async reads on every operation.
 */

import joplin from 'api';
import { SettingItemType } from 'api/types';
import { logger } from './logger';

const SECTION_ID = 'contextUtils';

export const SETTING_SHOW_TOAST_MESSAGES = 'contextUtils.showToastMessages';
export const SETTING_SHOW_OPEN_LINK = 'contextUtils.showOpenLink';
export const SETTING_SHOW_COPY_PATH = 'contextUtils.showCopyPath';
export const SETTING_SHOW_REVEAL_FILE = 'contextUtils.showRevealFile';
export const SETTING_SHOW_COPY_CODE = 'contextUtils.showCopyCode';
export const SETTING_SHOW_COPY_OCR_TEXT = 'contextUtils.showCopyOcrText';
export const SETTING_SHOW_TOGGLE_TASK = 'contextUtils.showToggleTask';

/**
 * All setting keys used by the plugin
 */
const ALL_SETTINGS = [
    SETTING_SHOW_TOAST_MESSAGES,
    SETTING_SHOW_OPEN_LINK,
    SETTING_SHOW_COPY_PATH,
    SETTING_SHOW_REVEAL_FILE,
    SETTING_SHOW_COPY_CODE,
    SETTING_SHOW_COPY_OCR_TEXT,
    SETTING_SHOW_TOGGLE_TASK,
];

/**
 * Module-level settings cache for synchronous access
 */
export const settingsCache = {
    showToastMessages: true,
    showOpenLink: true,
    showCopyPath: true,
    showRevealFile: true,
    showCopyCode: true,
    showCopyOcrText: true,
    showToggleTask: true,
};

/**
 * Updates the settings cache by reading all values from Joplin settings
 */
async function updateSettingsCache(): Promise<void> {
    settingsCache.showToastMessages = await joplin.settings.value(SETTING_SHOW_TOAST_MESSAGES);
    settingsCache.showOpenLink = await joplin.settings.value(SETTING_SHOW_OPEN_LINK);
    settingsCache.showCopyPath = await joplin.settings.value(SETTING_SHOW_COPY_PATH);
    settingsCache.showRevealFile = await joplin.settings.value(SETTING_SHOW_REVEAL_FILE);
    settingsCache.showCopyCode = await joplin.settings.value(SETTING_SHOW_COPY_CODE);
    settingsCache.showCopyOcrText = await joplin.settings.value(SETTING_SHOW_COPY_OCR_TEXT);
    settingsCache.showToggleTask = await joplin.settings.value(SETTING_SHOW_TOGGLE_TASK);
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
        if (event.keys.some((key) => ALL_SETTINGS.includes(key))) {
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

    await joplin.settings.registerSettings({
        [SETTING_SHOW_TOAST_MESSAGES]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show toast notifications',
            description: 'Display brief notification messages for plugin actions (e.g., "Copied to clipboard")',
        },
        [SETTING_SHOW_OPEN_LINK]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Open Link" in context menu',
            description: 'Display option to open external URLs in browser or Joplin resources in default app',
        },
        [SETTING_SHOW_COPY_PATH]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy Path" in context menu',
            description: 'Display option to copy URL or resource file path to clipboard',
        },
        [SETTING_SHOW_REVEAL_FILE]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Reveal File" in context menu',
            description: 'Display option to reveal Joplin resource files in file explorer',
        },
        [SETTING_SHOW_COPY_CODE]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy Code" in context menu',
            description: 'Display option to copy code from inline code or code blocks to clipboard',
        },
        [SETTING_SHOW_COPY_OCR_TEXT]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show "Copy OCR Text" in context menu',
            description: 'Display option to copy OCR text from image resources when available',
        },
        [SETTING_SHOW_TOGGLE_TASK]: {
            value: true,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: 'Show task toggle options in context menu',
            description: 'Display options to check/uncheck task list checkboxes ([ ] ↔ [x])',
        },
    });
}
