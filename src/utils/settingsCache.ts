/**
 * Centralized settings cache to avoid async reads on every operation.
 *
 * This module maintains an in-memory cache of all plugin settings and
 * automatically updates when settings change via joplin.settings.onChange().
 */

import joplin from 'api';
import { logger } from '../logger';
import {
    SETTING_SHOW_TOAST_MESSAGES,
    SETTING_SHOW_OPEN_LINK,
    SETTING_SHOW_COPY_PATH,
    SETTING_SHOW_REVEAL_FILE,
    SETTING_SHOW_COPY_CODE,
    SETTING_SHOW_COPY_OCR_TEXT,
    SETTING_SHOW_TOGGLE_TASK,
} from '../settings';

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
 * Must be called once during plugin initialization.
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
