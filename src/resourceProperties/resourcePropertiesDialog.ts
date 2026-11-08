/**
 * Resource Properties dialog: renders a resource's properties with an editable name,
 * and reads the user's changes back from the dialog form.
 */

import joplin from 'api';
import { logger } from '../logger';
import { formatFileSize, getResourceDisplayName, type ReferencingNote, type ResourceProperties } from './resourceData';

const DIALOG_ID = 'contextUtilsResourcePropertiesDialog';
const DIALOG_SCRIPT = './resourceProperties/webview/resourcePropertiesDialog.js';
const DIALOG_STYLESHEET = './resourceProperties/webview/resourcePropertiesDialog.css';
const FORM_NAME = 'resourceProperties';

const FIELD_NAMES = {
    NAME: 'name',
    UPDATE_LINK_LABEL: 'updateLinkLabel',
} as const;

// Joplin clicks the first "ok" button on Enter and the first "cancel" button on Escape.
const BUTTON_IDS = {
    SAVE: 'ok',
    CANCEL: 'cancel',
} as const;

/** What the dialog shows. */
export interface ResourcePropertiesDialogInput {
    resource: ResourceProperties;
    referencingNotes: ReferencingNote[];
    /** Whether the link at the cursor has a label that renaming can update */
    canUpdateLinkLabel: boolean;
    /** Initial state of the "update link text" checkbox */
    updateLinkLabelByDefault: boolean;
}

/** The changes the user saved. */
export interface ResourcePropertiesDialogResult {
    name: string;
    updateLinkLabel: boolean;
}

/** Opens the dialog; resolves to null when the user cancels or the dialog is already open. */
export type ResourcePropertiesPrompt = (
    input: ResourcePropertiesDialogInput
) => Promise<ResourcePropertiesDialogResult | null>;

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function formatTime(time: number): string {
    return time > 0 ? new Date(time).toLocaleString() : 'Unknown';
}

function renderRow(label: string, value: string, valueClass = ''): string {
    const classes = valueClass ? `value ${valueClass}` : 'value';
    return `<span class="field-label">${label}</span><span class="${classes}">${escapeHtml(value)}</span>`;
}

function renderReferencingNotes(notes: ReferencingNote[]): string {
    if (notes.length === 0) {
        return '<p class="empty">No notes reference this resource.</p>';
    }

    const items = notes
        .map((note) => `<li title="${escapeHtml(note.id)}">${escapeHtml(note.title || '(Untitled)')}</li>`)
        .join('');
    return `<ul class="notes">${items}</ul>`;
}

/** Builds the dialog form. All resource and note values are HTML-escaped. */
export function buildResourcePropertiesDialogHtml(input: ResourcePropertiesDialogInput): string {
    const { resource, referencingNotes } = input;
    const checked = input.updateLinkLabelByDefault ? ' checked' : '';
    // Sits in the value column, under the name input.
    const linkLabelOption = input.canUpdateLinkLabel
        ? `<label class="option"><input type="checkbox" name="${FIELD_NAMES.UPDATE_LINK_LABEL}"${checked}>` +
          ` Update link text in this note</label>`
        : '';

    return (
        `<form name="${FORM_NAME}" class="resource-properties" autocomplete="off">` +
        `<h4 class="dialog-head">Resource Properties</h4>` +
        `<div class="grid">` +
        `<label for="resourceName" class="field-label">Name</label>` +
        `<input type="text" id="resourceName" name="${FIELD_NAMES.NAME}" ` +
        `value="${escapeHtml(getResourceDisplayName(resource))}" ` +
        `data-extension="${escapeHtml(resource.fileExtension)}" spellcheck="false">` +
        linkLabelOption +
        renderRow('Filename', resource.filename || '(none)') +
        renderRow('Type', resource.mime || 'Unknown') +
        renderRow('Size', formatFileSize(resource.size)) +
        renderRow('Created', formatTime(resource.createdTime)) +
        renderRow('Updated', formatTime(resource.updatedTime)) +
        renderRow('ID', resource.id, 'resource-id') +
        `</div>` +
        `<section class="referenced-by">` +
        `<span class="field-label">Referenced by (${referencingNotes.length})</span>` +
        renderReferencingNotes(referencingNotes) +
        `</section>` +
        `</form>`
    );
}

/**
 * Converts the dialog's form data into the saved changes.
 * Browsers omit unchecked checkboxes from form data, so an absent checkbox means `false`.
 * Returns null when the form data is missing.
 */
export function parseResourcePropertiesFormData(formData: unknown): ResourcePropertiesDialogResult | null {
    const form = (formData as Record<string, unknown> | undefined)?.[FORM_NAME];
    if (!form || typeof form !== 'object') {
        logger.warn('Resource properties dialog returned no form data');
        return null;
    }

    const fields = form as Record<string, unknown>;
    const name = fields[FIELD_NAMES.NAME];
    return {
        name: typeof name === 'string' ? name.trim() : '',
        updateLinkLabel: FIELD_NAMES.UPDATE_LINK_LABEL in fields,
    };
}

/**
 * Creates the Resource Properties dialog and returns a prompt that opens it.
 * Must be called once, during plugin startup.
 */
export async function createResourcePropertiesDialog(): Promise<ResourcePropertiesPrompt> {
    const dialogs = joplin.views.dialogs;
    const handle = await dialogs.create(DIALOG_ID);
    await dialogs.setButtons(handle, [
        { id: BUTTON_IDS.SAVE, title: 'Save' },
        { id: BUTTON_IDS.CANCEL, title: 'Cancel' },
    ]);
    await dialogs.addScript(handle, DIALOG_STYLESHEET);
    await dialogs.addScript(handle, DIALOG_SCRIPT);

    let isOpen = false;
    return async (input) => {
        // Opening the dialog again while it's open makes Joplin show an error.
        // Set before the first await so no second call can slip through.
        if (isOpen) {
            logger.debug('Resource properties dialog is already open');
            return null;
        }
        isOpen = true;

        try {
            await dialogs.setHtml(handle, buildResourcePropertiesDialogHtml(input));
            const result = await dialogs.open(handle);
            if (result.id !== BUTTON_IDS.SAVE) return null;
            return parseResourcePropertiesFormData(result.formData);
        } finally {
            isOpen = false;
        }
    };
}
