/**
 * Joplin data API access and pure helpers for the Resource Properties dialog.
 */

import joplin from 'api';
import { escapeMarkdownLinkText } from '../utils/linkTitleUtils';

/** Properties shown in the Resource Properties dialog. */
export interface ResourceProperties {
    id: string;
    title: string;
    filename: string;
    mime: string;
    fileExtension: string;
    /** Size in bytes, or a negative number when Joplin does not know it */
    size: number;
    /** Unix time in milliseconds */
    createdTime: number;
    /** Unix time in milliseconds */
    updatedTime: number;
}

/** A note that links to the resource. */
export interface ReferencingNote {
    id: string;
    title: string;
}

/** Resource fields written when renaming. */
export interface RenamedResourceFields {
    title: string;
    filename: string;
}

const RESOURCE_FIELDS = [
    'id',
    'title',
    'filename',
    'mime',
    'file_extension',
    'size',
    'created_time',
    'updated_time',
    'user_created_time',
    'user_updated_time',
];

const NOTES_PAGE_LIMIT = 100;

/**
 * Characters that are invalid in filenames on common platforms, plus control characters.
 * Example: `a/b:c?.png` → `a_b_c_.png`
 */
// eslint-disable-next-line no-control-regex -- Control characters are intentionally matched.
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Markdown link label characters that must be escaped: `\`, `|` (tables), and brackets. */
const LINK_LABEL_BRACKETS = /[[\]]/g;

type RawResource = {
    id?: unknown;
    title?: unknown;
    filename?: unknown;
    mime?: unknown;
    file_extension?: unknown;
    size?: unknown;
    created_time?: unknown;
    updated_time?: unknown;
    user_created_time?: unknown;
    user_updated_time?: unknown;
};

type RawNotesPage = {
    items?: Array<{ id?: unknown; title?: unknown }>;
    has_more?: unknown;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Prefers the user-facing timestamp, which Joplin keeps when syncing or importing. */
const pickTime = (userTime: unknown, time: unknown): number => asNumber(userTime) || asNumber(time);

/**
 * Loads the resource's properties.
 * @throws When the resource does not exist
 */
export async function fetchResourceProperties(resourceId: string): Promise<ResourceProperties> {
    const raw = (await joplin.data.get(['resources', resourceId], { fields: RESOURCE_FIELDS })) as RawResource;
    return {
        id: asString(raw.id) || resourceId,
        title: asString(raw.title),
        filename: asString(raw.filename),
        mime: asString(raw.mime),
        fileExtension: asString(raw.file_extension),
        size: typeof raw.size === 'number' ? raw.size : -1,
        createdTime: pickTime(raw.user_created_time, raw.created_time),
        updatedTime: pickTime(raw.user_updated_time, raw.updated_time),
    };
}

/**
 * Loads every note that references the resource.
 *
 * Joplin builds this list from its background resource index, so a link added
 * moments ago may not be listed yet.
 */
export async function fetchReferencingNotes(resourceId: string): Promise<ReferencingNote[]> {
    const notes: ReferencingNote[] = [];
    for (let page = 1; ; page++) {
        const result = (await joplin.data.get(['resources', resourceId, 'notes'], {
            fields: ['id', 'title'],
            limit: NOTES_PAGE_LIMIT,
            page,
        })) as RawNotesPage;

        for (const item of result.items ?? []) {
            notes.push({ id: asString(item.id), title: asString(item.title) });
        }

        if (result.has_more !== true) return notes;
    }
}

/** Writes the renamed title and filename. */
export async function renameResource(resourceId: string, fields: RenamedResourceFields): Promise<void> {
    await joplin.data.put(['resources', resourceId], null, fields);
}

/** The name the dialog shows: the title, or the original filename for untitled resources. */
export function getResourceDisplayName(resource: ResourceProperties): string {
    return resource.title || resource.filename;
}

/**
 * Builds the title and filename for a new resource name.
 *
 * The title is the name as typed. The filename has invalid characters replaced with
 * `_` and keeps the resource's file extension, which the name may omit.
 *
 * @example
 * Name `Holiday` with extension `jpg` gives the title `Holiday` and filename `Holiday.jpg`.
 * Name `a/b.JPG` with extension `jpg` gives the title `a/b.JPG` and filename `a_b.JPG`.
 */
export function buildRenamedResourceFields(name: string, fileExtension: string): RenamedResourceFields {
    const filename = name.replace(INVALID_FILENAME_CHARS, '_');
    const hasExtension = !fileExtension || filename.toLowerCase().endsWith(`.${fileExtension.toLowerCase()}`);
    return {
        title: name,
        filename: hasExtension ? filename : `${filename}.${fileExtension}`,
    };
}

/** Escapes a resource name for use as a markdown link or image label. */
export function escapeLinkLabel(name: string): string {
    return escapeMarkdownLinkText(name).replace(LINK_LABEL_BRACKETS, '\\$&');
}

/**
 * True when a link label still shows the resource's name, as Joplin writes it when
 * attaching a file. Custom labels return false, so renaming leaves them alone by default.
 */
export function isDefaultLinkLabel(label: string, resource: ResourceProperties): boolean {
    return [resource.title, resource.filename]
        .filter((name) => name !== '')
        .some((name) => label === name || label === escapeLinkLabel(name));
}

/**
 * Formats a byte count for display.
 * @example formatFileSize(1536) // '1.5 KB (1,536 bytes)'
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 0) return 'Unknown';

    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }

    const exact = `${bytes.toLocaleString('en-US')} bytes`;
    if (unit === 0) return exact;
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]} (${exact})`;
}
