import { vi } from 'vitest';

import { BATCH_REPLACE_COMMAND } from '../contentScripts/editor/contentScript';
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

function linkContext(label: string | null = 'photo.png'): LinkContext {
    return {
        contextType: 'link',
        url: `:/${RESOURCE_ID}`,
        type: LinkType.JoplinResource,
        from: 0,
        to: 10,
        isImage: true,
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

    it('disables the link text option when the link has no label', async () => {
        const prompt = promptReturning(null);

        await editResourceProperties(linkContext(null), prompt);

        expect(prompt.mock.calls[0]?.[0]).toMatchObject({ canUpdateLinkLabel: false, updateLinkLabelByDefault: false });
    });

    it('renames the resource and updates the link label', async () => {
        await editResourceProperties(linkContext(), promptReturning({ name: 'Beach [1]', updateLinkLabel: true }));

        expect(apiMocks.dataPut).toHaveBeenCalledWith(['resources', RESOURCE_ID], null, {
            title: 'Beach [1]',
            filename: 'Beach [1].png',
        });
        expect(apiMocks.execute).toHaveBeenCalledWith('editor.execCommand', {
            name: BATCH_REPLACE_COMMAND,
            args: [[{ from: 7, to: 16, text: 'Beach \\[1\\]', expectedText: 'photo.png' }]],
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
            args: [[{ from: 7, to: 16, text: '&lt;attachment&gt;', expectedText: 'photo.png' }]],
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
            ToastType.Error
        );
    });
});
