import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

import type { ResourceProperties } from './resourceData';
import {
    buildResourcePropertiesDialogHtml,
    createResourcePropertiesDialog,
    parseResourcePropertiesFormData,
    type ResourcePropertiesDialogInput,
} from './resourcePropertiesDialog';

const dialogMocks = vi.hoisted(() => ({
    create: vi.fn(),
    setButtons: vi.fn(),
    addScript: vi.fn(),
    setHtml: vi.fn(),
    open: vi.fn(),
}));

vi.mock('api', () => ({
    default: { views: { dialogs: dialogMocks } },
}));

const webviewScript = readFileSync(
    resolve(process.cwd(), 'src/resourceProperties/webview/resourcePropertiesDialog.js'),
    'utf8'
);

function resource(overrides: Partial<ResourceProperties> = {}): ResourceProperties {
    return {
        id: 'a'.repeat(32),
        title: 'photo.png',
        filename: 'photo.png',
        mime: 'image/png',
        fileExtension: 'png',
        size: 2048,
        createdTime: Date.UTC(2026, 0, 2),
        updatedTime: Date.UTC(2026, 0, 3),
        ...overrides,
    };
}

function input(overrides: Partial<ResourcePropertiesDialogInput> = {}): ResourcePropertiesDialogInput {
    return {
        resource: resource(),
        referencingNotes: [{ id: 'n1', title: 'First note' }],
        canUpdateLinkLabel: true,
        updateLinkLabelByDefault: true,
        ...overrides,
    };
}

/** Renders the dialog into the document and returns its form, as the Joplin webview would. */
function renderDialog(html: string): HTMLFormElement {
    document.body.innerHTML = html;
    return document.querySelector('form')!;
}

/** Serializes a form the way Joplin's webview does: one entry per `FormData` key, keyed by form name. */
function serializeForm(form: HTMLFormElement): Record<string, Record<string, FormDataEntryValue>> {
    return { [form.getAttribute('name')!]: Object.fromEntries(new FormData(form)) };
}

function field<T extends Element>(form: HTMLFormElement, name: string): T {
    return form.elements.namedItem(name) as T;
}

describe('resource properties dialog form', () => {
    it('shows the resource properties and referencing notes', () => {
        const form = renderDialog(buildResourcePropertiesDialogHtml(input()));

        expect(field<HTMLInputElement>(form, 'name').value).toBe('photo.png');
        expect(form.querySelector('.resource-id')?.textContent).toBe('a'.repeat(32));
        expect(form.textContent).toContain('image/png');
        expect(form.textContent).toContain('2.0 KB (2,048 bytes)');
        expect(form.textContent).toContain('Referenced by (1)');
        expect([...form.querySelectorAll('.notes li')].map((item) => item.textContent)).toEqual(['First note']);
    });

    it('escapes resource and note values', () => {
        const form = renderDialog(
            buildResourcePropertiesDialogHtml(
                input({
                    resource: resource({ title: '"><img src=x onerror=alert(1)>' }),
                    referencingNotes: [
                        { id: 'n1', title: '<b>bold</b>' },
                        { id: 'n2', title: '' },
                    ],
                })
            )
        );

        expect(form.querySelector('img')).toBeNull();
        expect(form.querySelector('b')).toBeNull();
        expect(field<HTMLInputElement>(form, 'name').value).toBe('"><img src=x onerror=alert(1)>');
        expect([...form.querySelectorAll('.notes li')].map((item) => item.textContent)).toEqual([
            '<b>bold</b>',
            '(Untitled)',
        ]);
    });

    it('falls back to the filename for an untitled resource', () => {
        const form = renderDialog(buildResourcePropertiesDialogHtml(input({ resource: resource({ title: '' }) })));

        expect(field<HTMLInputElement>(form, 'name').value).toBe('photo.png');
    });

    it('says when no notes reference the resource', () => {
        const form = renderDialog(buildResourcePropertiesDialogHtml(input({ referencingNotes: [] })));

        expect(form.querySelector('.empty')?.textContent).toBe('No notes reference this resource.');
    });

    it('omits the link text option when the link has no label', () => {
        const form = renderDialog(buildResourcePropertiesDialogHtml(input({ canUpdateLinkLabel: false })));

        expect(field(form, 'updateLinkLabel')).toBeNull();
        expect(parseResourcePropertiesFormData(serializeForm(form))?.updateLinkLabel).toBe(false);
    });

    it.each([true, false])('round-trips the link text option when checked is %s', (checked) => {
        const form = renderDialog(buildResourcePropertiesDialogHtml(input({ updateLinkLabelByDefault: checked })));
        field<HTMLInputElement>(form, 'name').value = '  Renamed.png  ';

        expect(parseResourcePropertiesFormData(serializeForm(form))).toEqual({
            name: 'Renamed.png',
            updateLinkLabel: checked,
        });
    });

    it('returns null when the form data is missing', () => {
        expect(parseResourcePropertiesFormData(undefined)).toBeNull();
    });
});

describe('resource properties webview script', () => {
    const runScript = (): void => {
        window.eval(webviewScript);
    };

    it.each([
        { title: 'photo.png', extension: 'png', selected: 'photo' },
        { title: 'photo', extension: 'png', selected: 'photo' },
        { title: 'notes', extension: '', selected: 'notes' },
    ])('focuses the name and selects "$selected" of "$title"', ({ title, extension, selected }) => {
        const form = renderDialog(
            buildResourcePropertiesDialogHtml(input({ resource: resource({ title, fileExtension: extension }) }))
        );
        runScript();

        const name = field<HTMLInputElement>(form, 'name');
        expect(document.activeElement).toBe(name);
        expect(name.value.slice(name.selectionStart!, name.selectionEnd!)).toBe(selected);
    });
});

describe('createResourcePropertiesDialog', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        dialogMocks.create.mockResolvedValue('handle');
    });

    it('returns the saved changes', async () => {
        dialogMocks.open.mockResolvedValue({
            id: 'ok',
            formData: { resourceProperties: { name: 'New.png', updateLinkLabel: 'on' } },
        });
        const prompt = await createResourcePropertiesDialog();

        await expect(prompt(input())).resolves.toEqual({ name: 'New.png', updateLinkLabel: true });
        expect(dialogMocks.setHtml).toHaveBeenCalledWith('handle', expect.stringContaining('photo.png'));
    });

    it('returns null when cancelled', async () => {
        dialogMocks.open.mockResolvedValue({ id: 'cancel' });
        const prompt = await createResourcePropertiesDialog();

        await expect(prompt(input())).resolves.toBeNull();
    });

    it('does not open a second dialog while one is open', async () => {
        let close: ((result: { id: string }) => void) | undefined;
        dialogMocks.open.mockReturnValue(
            new Promise((resolveOpen) => {
                close = resolveOpen;
            })
        );
        const prompt = await createResourcePropertiesDialog();

        const first = prompt(input());
        await expect(prompt(input())).resolves.toBeNull();
        close?.({ id: 'cancel' });
        await first;

        expect(dialogMocks.open).toHaveBeenCalledOnce();
    });
});
