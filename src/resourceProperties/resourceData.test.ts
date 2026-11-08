import { parser, Table } from '@lezer/markdown';
import { vi } from 'vitest';

import { findHtmlImage } from '../contentScripts/editor/htmlImage';
import {
    buildLinkLabelReplacement,
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
        { name: '<attachment>', extension: 'png', filename: '_attachment_.png' },
    ])('builds "$filename" from "$name"', ({ name, extension, filename }) => {
        expect(buildRenamedResourceFields(name, extension)).toEqual({ title: name, filename });
    });
});

describe('link labels', () => {
    it.each(['alt="photo.png"', ''])('preserves table cells when updating HTML %s with pipes', (alt) => {
        const html = `<img src=":/${RESOURCE_ID}" ${alt} width="200">`;
        const label = findHtmlImage(html)!.label;
        const name = 'left | right & &#124;';
        const replacement = buildLinkLabelReplacement(name, label);
        const updated = html.slice(0, label.from) + replacement + html.slice(label.to);
        const doc = `| Image | Other |\n| --- | --- |\n| ${updated} | Text |`;
        const tree = parser.configure([Table]).parse(doc);
        const cells = tree.topNode.getChild('Table')!.getChild('TableRow')!.getChildren('TableCell');

        expect(cells.map((cell) => doc.slice(cell.from, cell.to))).toEqual([updated, 'Text']);
        expect(cells[0]!.getChild('HTMLTag')).not.toBeNull();

        const container = document.createElement('div');
        container.innerHTML = doc.slice(cells[0]!.from, cells[0]!.to);
        const image = container.querySelector('img')!;
        expect(image.alt).toBe(name);
        expect(image.getAttribute('src')).toBe(`:/${RESOURCE_ID}`);
        expect(image.getAttribute('width')).toBe('200');
    });

    it('escapes characters that would break a link label', () => {
        expect(escapeLinkLabel('a [draft] | b\\c')).toBe('a \\[draft\\] \\| b\\\\c');
    });

    it.each([
        { name: '`draft', escaped: '\\`draft' },
        { name: '<span title="draft">photo</span>', escaped: '&lt;span title="draft"&gt;photo&lt;/span&gt;' },
        { name: '<https://example.com>', escaped: '&lt;https://example.com&gt;' },
        { name: '<!-- draft', escaped: '&lt;!-- draft' },
        { name: '<?draft', escaped: '&lt;?draft' },
        { name: '<attachment> <img> <>', escaped: '&lt;attachment&gt; &lt;img&gt; &lt;&gt;' },
        { name: 'a > b', escaped: 'a &gt; b' },
        { name: 'report &copy; &#169; &#xA9;.pdf', escaped: 'report &amp;copy; &amp;#169; &amp;#xA9;.pdf' },
        { name: '&amp;lt;', escaped: '&amp;amp;lt;' },
        { name: 'Tom & Jerry, a < b, my_image.png', escaped: 'Tom & Jerry, a &lt; b, my_image.png' },
        { name: '&amp Jerry &#12345678; &#x1234567;', escaped: '&amp Jerry &#12345678; &#x1234567;' },
    ])('escapes "$name" for a label', ({ name, escaped }) => {
        expect(escapeLinkLabel(name)).toBe(escaped);
    });

    it.each(['link', 'image'])('preserves the resource %s and subsequent inline code', (kind) => {
        const url = `:/${RESOURCE_ID}`;
        const prefix = kind === 'image' ? '!' : '';
        const label = escapeLinkLabel('`draft [1] <span title="');
        const doc = `${prefix}[${label}](${url}) then \`code\` and ">`;
        const tree = parser.parse(doc);
        const paragraph = tree.topNode.firstChild!;
        const link = paragraph.firstChild!;

        expect(link.name).toBe(kind === 'image' ? 'Image' : 'Link');
        expect(doc.slice(link.getChild('URL')!.from, link.getChild('URL')!.to)).toBe(url);
        expect(link.nextSibling?.name).toBe('InlineCode');
        expect(doc.slice(link.nextSibling!.from, link.nextSibling!.to)).toBe('`code`');
    });

    it('recognizes escaped resource names as default labels', () => {
        const title = '`draft <photo> &copy;.png';
        const label = '\\`draft &lt;photo&gt; &amp;copy;.png';

        expect(isDefaultLinkLabel(label, resource({ title }))).toBe(true);
    });

    it('keeps literal entity names distinct from angle brackets', () => {
        const title = '&lt;attachment&gt;';

        expect(escapeLinkLabel(title)).toBe('&amp;lt;attachment&amp;gt;');
        expect(isDefaultLinkLabel('&amp;lt;attachment&amp;gt;', resource({ title }))).toBe(true);
    });

    it.each(['<attachment> <img> <>', '&lt;attachment&gt;'])('preserves the displayed name "%s"', (title) => {
        const label = document.createElement('span');
        label.innerHTML = escapeLinkLabel(title);

        expect(label.textContent).toBe(title);
        expect(label.children).toHaveLength(0);
    });

    it.each([
        { label: 'scan [1].png', expected: true },
        { label: 'scan \\[1\\].png', expected: true },
        { label: 'Original.png', expected: true },
        { label: 'My custom alt text', expected: false },
        { label: '', expected: true },
    ])('treats "$label" as default: $expected', ({ label, expected }) => {
        const named = resource({ title: 'scan [1].png', filename: 'Original.png' });
        expect(isDefaultLinkLabel(label, named)).toBe(expected);
    });

    it('treats an empty label as default for an untitled resource', () => {
        expect(isDefaultLinkLabel('', resource({ title: '', filename: '' }))).toBe(true);
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
