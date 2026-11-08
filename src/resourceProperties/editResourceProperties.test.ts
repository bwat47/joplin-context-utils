import { vi } from 'vitest';

import { BATCH_REPLACE_COMMAND } from '../contentScripts/editor/contentScript';
import { parseImageTag } from '../contentScripts/editor/parsingUtils';
import { LinkType, type LinkContext } from '../types';
import { showToast, ToastType } from '../utils/toastUtils';
import { editResourceProperties } from './editResourceProperties';
import type { ResourcePropertiesDialogResult, ResourcePropertiesPrompt } from './resourcePropertiesDialog';

const apiMocks = vi.hoisted(() => ({
    execute: vi.fn(),
    dataGet: vi.fn(),
    dataPut: vi.fn(),
}));

vi.mock('api', () => ({
    default: {
        commands: { execute: apiMocks.execute },
        data: { get: apiMocks.dataGet, put: apiMocks.dataPut },
    },
}));

vi.mock('../utils/toastUtils', () => ({
    showToast: vi.fn(),
    ToastType: { Success: 'success', Error: 'error', Info: 'info' },
}));

const RESOURCE_ID = 'a'.repeat(32);
const DOC_PREFIX = 'Text ![';
const NOTE_ID = 'n'.repeat(32);

function linkContext(label: string | null = 'photo.png'): LinkContext {
    const markdown = `![${label ?? ''}](:/${RESOURCE_ID})`;
    return {
        noteId: NOTE_ID,
        contextType: 'link',
        url: `:/${RESOURCE_ID}`,
        type: LinkType.JoplinResource,
        from: 0,
        to: 10,
        isImage: true,
        markdownLinkFrom: DOC_PREFIX.length - 2,
        markdownLinkTo: DOC_PREFIX.length - 2 + markdown.length,
        expectedText: markdown,
        linkLabel:
            label === null ? undefined : { text: label, from: DOC_PREFIX.length, to: DOC_PREFIX.length + label.length },
    };
}

function promptReturning(result: ResourcePropertiesDialogResult | null): ResourcePropertiesPrompt & {
    mock: { calls: unknown[][] };
} {
    return vi.fn<ResourcePropertiesPrompt>().mockResolvedValue(result);
}

beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.dataGet.mockImplementation((path: string[]) =>
        Promise.resolve(
            path.length === 3
                ? { items: [{ id: 'n1', title: 'Note' }], has_more: false }
                : { id: RESOURCE_ID, title: 'photo.png', filename: 'photo.png', file_extension: 'png', size: 1 }
        )
    );
    apiMocks.execute.mockResolvedValue(true);
});

describe('editResourceProperties', () => {
    it.each([
        { alt: 'alt="photo.png"', checked: true },
        { alt: "alt='photo.png'", checked: true },
        { alt: 'alt="photo&#46;png"', checked: true },
        { alt: 'alt="Custom description"', checked: false },
        { alt: 'alt=""', checked: true },
        { alt: "alt=''", checked: true },
        { alt: '', checked: true },
    ])('updates HTML $alt and preserves dimensions and other attributes', async ({ alt, checked }) => {
        const html = `<img src=":/${RESOURCE_ID}" ${alt} width="250" height="100" style="display: block;" />`;
        const context: LinkContext = {
            ...parseImageTag(html)!,
            contextType: 'link',
            noteId: NOTE_ID,
            from: 0,
            to: html.length,
            isImage: true,
        };
        const name = `Beach "one" & <two> [draft] \\path`;
        const prompt = promptReturning({ name, updateLinkLabel: true });
        await editResourceProperties(context, prompt);
        expect(prompt.mock.calls[0]?.[0]).toMatchObject({
            canUpdateLinkLabel: true,
            updateLinkLabelByDefault: checked,
        });
        const invocation = apiMocks.execute.mock.calls[0]![1] as {
            args: [[{ from: number; to: number; text: string; expectedText: string }], unknown];
        };
        const replacement = invocation.args[0][0];
        expect(replacement.expectedText).toBe(alt);
        expect(invocation.args[1]).toEqual({ noteId: NOTE_ID, from: 0, to: html.length, expectedText: html });
        const updated = html.slice(0, replacement.from) + replacement.text + html.slice(replacement.to);
        expect(updated).toContain(`src=":/${RESOURCE_ID}"${alt ? '' : replacement.text}`);
        const container = document.createElement('div');
        container.innerHTML = updated;
        const image = container.querySelector('img')!;
        expect(image.alt).toBe(name);
        expect(image.getAttribute('src')).toBe(`:/${RESOURCE_ID}`);
        expect(image.getAttribute('width')).toBe('250');
        expect(image.getAttribute('height')).toBe('100');
        expect(image.getAttribute('style')).toBe('display: block;');
        expect(updated.replace(replacement.text, alt ? alt : '')).toBe(html);
    });

    it('does not rewrite an unchanged HTML alt value just to normalize its quoting', async () => {
        const html = `<img src=":/${RESOURCE_ID}" alt='photo&#46;png' width="250">`;
        const context: LinkContext = {
            ...parseImageTag(html)!,
            contextType: 'link',
            noteId: NOTE_ID,
            from: 0,
            to: html.length,
            isImage: true,
        };
        await editResourceProperties(context, promptReturning({ name: 'photo.png', updateLinkLabel: true }));
        expect(apiMocks.execute).not.toHaveBeenCalled();
        expect(apiMocks.dataPut).not.toHaveBeenCalled();
    });
    it('defaults the link text option on when the label matches the resource name', async () => {
        const prompt = promptReturning(null);

        await editResourceProperties(linkContext(), prompt);

        expect(prompt.mock.calls[0]?.[0]).toMatchObject({
            referencingNotes: [{ id: 'n1', title: 'Note' }],
            canUpdateLinkLabel: true,
            updateLinkLabelByDefault: true,
        });
        expect(apiMocks.dataPut).not.toHaveBeenCalled();
    });

    it('defaults the link text option off for a custom label', async () => {
        const prompt = promptReturning(null);

        await editResourceProperties(linkContext('My holiday'), prompt);

        expect(prompt.mock.calls[0]?.[0]).toMatchObject({ canUpdateLinkLabel: true, updateLinkLabelByDefault: false });
    });

    it('defaults the link text option on for empty Markdown alt text', async () => {
        const prompt = promptReturning(null);

        await editResourceProperties(linkContext(''), prompt);

        expect(prompt.mock.calls[0]?.[0]).toMatchObject({ canUpdateLinkLabel: true, updateLinkLabelByDefault: true });
    });

    it('disables the link text option when the link has no label', async () => {
        const prompt = promptReturning(null);

        await editResourceProperties(linkContext(null), prompt);

        expect(prompt.mock.calls[0]?.[0]).toMatchObject({ canUpdateLinkLabel: false, updateLinkLabelByDefault: false });
    });

    it.each(['noteId', 'expectedText', 'markdownLinkFrom', 'markdownLinkTo'] as const)(
        'does not update link text without %s',
        async (field) => {
            const context = linkContext();
            delete context[field];
            const prompt = promptReturning({ name: 'Beach', updateLinkLabel: true });
            await editResourceProperties(context, prompt);
            expect(prompt.mock.calls[0]?.[0]).toMatchObject({
                canUpdateLinkLabel: false,
                updateLinkLabelByDefault: false,
            });
            expect(apiMocks.dataPut).toHaveBeenCalledOnce();
            expect(apiMocks.execute).not.toHaveBeenCalled();
        }
    );

    it('renames the resource and updates the link label', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: 'Beach [1]', updateLinkLabel: true }));

        expect(apiMocks.dataPut).toHaveBeenCalledWith(['resources', RESOURCE_ID], null, {
            title: 'Beach [1]',
            filename: 'Beach [1].png',
        });
        expect(apiMocks.execute).toHaveBeenCalledWith('editor.execCommand', {
            name: BATCH_REPLACE_COMMAND,
            args: [
                [{ from: 7, to: 16, text: 'Beach \\[1\\]', expectedText: 'photo.png' }],
                {
                    noteId: NOTE_ID,
                    from: 5,
                    to: 5 + `![photo.png](:/${RESOURCE_ID})`.length,
                    expectedText: `![photo.png](:/${RESOURCE_ID})`,
                },
            ],
        });
        expect(showToast).toHaveBeenCalledWith('Resource and link text renamed', ToastType.Success);
    });

    it('renames only the resource when the link text option is off', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: 'Beach', updateLinkLabel: false }));

        expect(apiMocks.dataPut).toHaveBeenCalledOnce();
        expect(apiMocks.execute).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Resource renamed', ToastType.Success);
    });

    it('preserves angles in the title, sanitizes the filename, and entity-encodes the link label', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: '<attachment>', updateLinkLabel: true }));

        expect(apiMocks.dataPut).toHaveBeenCalledWith(['resources', RESOURCE_ID], null, {
            title: '<attachment>',
            filename: '_attachment_.png',
        });
        expect(apiMocks.execute).toHaveBeenCalledWith('editor.execCommand', {
            name: BATCH_REPLACE_COMMAND,
            args: [
                [{ from: 7, to: 16, text: '&lt;attachment&gt;', expectedText: 'photo.png' }],
                expect.objectContaining({ noteId: NOTE_ID }),
            ],
        });
    });

    it('updates only the link label when the name is unchanged', async () => {
        await editResourceProperties(
            linkContext('custom'),
            promptReturning({ name: 'photo.png', updateLinkLabel: true })
        );

        expect(apiMocks.dataPut).not.toHaveBeenCalled();
        expect(apiMocks.execute).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenCalledWith('Link text updated', ToastType.Success);
    });

    it('does nothing when nothing changed', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: 'photo.png', updateLinkLabel: true }));

        expect(apiMocks.dataPut).not.toHaveBeenCalled();
        expect(apiMocks.execute).not.toHaveBeenCalled();
        expect(showToast).not.toHaveBeenCalled();
    });

    it('rejects an empty name', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: '', updateLinkLabel: true }));

        expect(apiMocks.dataPut).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Resource name cannot be empty', ToastType.Error);
    });

    it('reports when the note changed before the link label could be updated', async () => {
        apiMocks.execute.mockResolvedValue(false);

        await editResourceProperties(linkContext(), promptReturning({ name: 'Beach', updateLinkLabel: true }));

        expect(apiMocks.dataPut).toHaveBeenCalledOnce();
        expect(showToast).toHaveBeenCalledWith(
            'Resource renamed; note changed, so link text was not updated',
            ToastType.Info
        );
    });
});
