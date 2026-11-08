import { vi } from 'vitest';

import {
    buildRenamedResourceFields,
    escapeLinkLabel,
    fetchReferencingNotes,
    fetchResourceProperties,
    formatFileSize,
    isDefaultLinkLabel,
    renameResource,
    type ResourceProperties,
} from './resourceData';

const apiMocks = vi.hoisted(() => ({
    dataGet: vi.fn(),
    dataPut: vi.fn(),
}));

vi.mock('api', () => ({
    default: {
        data: { get: apiMocks.dataGet, put: apiMocks.dataPut },
    },
}));

const RESOURCE_ID = 'a'.repeat(32);

function resource(overrides: Partial<ResourceProperties> = {}): ResourceProperties {
    return {
        id: RESOURCE_ID,
        title: 'photo.png',
        filename: 'photo.png',
        mime: 'image/png',
        fileExtension: 'png',
        size: 1024,
        createdTime: 1,
        updatedTime: 2,
        ...overrides,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('fetchResourceProperties', () => {
    it('maps API fields and prefers user timestamps', async () => {
        apiMocks.dataGet.mockResolvedValue({
            id: RESOURCE_ID,
            title: 'Photo',
            filename: 'photo.png',
            mime: 'image/png',
            file_extension: 'png',
            size: 2048,
            created_time: 10,
            updated_time: 20,
            user_created_time: 5,
            user_updated_time: 0,
        });

        await expect(fetchResourceProperties(RESOURCE_ID)).resolves.toEqual({
            id: RESOURCE_ID,
            title: 'Photo',
            filename: 'photo.png',
            mime: 'image/png',
            fileExtension: 'png',
            size: 2048,
            createdTime: 5,
            updatedTime: 20,
        });
        expect(apiMocks.dataGet).toHaveBeenCalledWith(['resources', RESOURCE_ID], {
            fields: expect.arrayContaining(['title', 'filename', 'size']) as unknown,
        });
    });

    it('treats missing values as unknown', async () => {
        apiMocks.dataGet.mockResolvedValue({});

        await expect(fetchResourceProperties(RESOURCE_ID)).resolves.toMatchObject({
            id: RESOURCE_ID,
            title: '',
            size: -1,
            createdTime: 0,
        });
    });
});

describe('fetchReferencingNotes', () => {
    it('reads every page of referencing notes', async () => {
        apiMocks.dataGet
            .mockResolvedValueOnce({ items: [{ id: 'n1', title: 'One' }], has_more: true })
            .mockResolvedValueOnce({ items: [{ id: 'n2', title: 'Two' }], has_more: false });

        await expect(fetchReferencingNotes(RESOURCE_ID)).resolves.toEqual([
            { id: 'n1', title: 'One' },
            { id: 'n2', title: 'Two' },
        ]);
        expect(apiMocks.dataGet).toHaveBeenLastCalledWith(['resources', RESOURCE_ID, 'notes'], {
            fields: ['id', 'title'],
            limit: 100,
            page: 2,
        });
    });
});

describe('renameResource', () => {
    it('writes the title and filename', async () => {
        await renameResource(RESOURCE_ID, { title: 'New', filename: 'New.png' });

        expect(apiMocks.dataPut).toHaveBeenCalledWith(['resources', RESOURCE_ID], null, {
            title: 'New',
            filename: 'New.png',
        });
    });
});

describe('buildRenamedResourceFields', () => {
    it.each([
        { name: 'Holiday', extension: 'jpg', filename: 'Holiday.jpg' },
        { name: 'Holiday.jpg', extension: 'jpg', filename: 'Holiday.jpg' },
        { name: 'Holiday.JPG', extension: 'jpg', filename: 'Holiday.JPG' },
        { name: 'Holiday.png', extension: 'jpg', filename: 'Holiday.png.jpg' },
        { name: 'notes', extension: '', filename: 'notes' },
        { name: 'a/b:c?.pdf', extension: 'pdf', filename: 'a_b_c_.pdf' },
    ])('builds "$filename" from "$name"', ({ name, extension, filename }) => {
        expect(buildRenamedResourceFields(name, extension)).toEqual({ title: name, filename });
    });
});

describe('link labels', () => {
    it('escapes characters that would break a link label', () => {
        expect(escapeLinkLabel('a [draft] | b\\c')).toBe('a \\[draft\\] \\| b\\\\c');
    });

    it.each([
        { label: 'scan [1].png', expected: true },
        { label: 'scan \\[1\\].png', expected: true },
        { label: 'Original.png', expected: true },
        { label: 'My custom alt text', expected: false },
        { label: '', expected: false },
    ])('treats "$label" as default: $expected', ({ label, expected }) => {
        const named = resource({ title: 'scan [1].png', filename: 'Original.png' });
        expect(isDefaultLinkLabel(label, named)).toBe(expected);
    });

    it('does not treat an empty label as default for an untitled resource', () => {
        expect(isDefaultLinkLabel('', resource({ title: '', filename: '' }))).toBe(false);
    });
});

describe('formatFileSize', () => {
    it.each([
        { bytes: -1, expected: 'Unknown' },
        { bytes: 0, expected: '0 bytes' },
        { bytes: 1023, expected: '1,023 bytes' },
        { bytes: 1536, expected: '1.5 KB (1,536 bytes)' },
        { bytes: 15 * 1024 * 1024, expected: '15 MB (15,728,640 bytes)' },
    ])('formats $bytes', ({ bytes, expected }) => {
        expect(formatFileSize(bytes)).toBe(expected);
    });
});
