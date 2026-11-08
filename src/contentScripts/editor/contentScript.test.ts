import { markdown } from '@codemirror/lang-markdown';
import { EditorState, Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

import type { CodeMirrorControl } from 'api/types';
import type { LinkContext, TextReplacementGuard } from '../../types';
import contentScript, {
    BATCH_REPLACE_COMMAND,
    GET_CONTEXT_AT_CURSOR_COMMAND,
    mapPositionThroughReplacements,
} from './contentScript';

describe('guarded resource label replacement', () => {
    const resourceId = 'a'.repeat(32);
    const original = `![photo.png](:/${resourceId} "Photo")`;
    const guard: TextReplacementGuard = { noteId: 'note-a', from: 0, to: original.length, expectedText: original };
    const replacement = { from: 2, to: 11, text: 'Beach', expectedText: 'photo.png' };
    let view: EditorView;

    function setup(
        doc = original,
        noteId = 'note-a'
    ): Map<string, Parameters<CodeMirrorControl['registerCommand']>[1]> {
        const noteIdFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });
        view = new EditorView({
            state: EditorState.create({
                doc,
                selection: { anchor: 4 },
                extensions: [markdown(), noteIdFacet.of(noteId)],
            }),
        });
        const commands = new Map<string, Parameters<CodeMirrorControl['registerCommand']>[1]>();
        const control = {
            cm6: {},
            editor: view,
            joplinExtensions: { noteIdFacet },
            addExtension: vi.fn(),
            registerCommand: (name: string, callback: Parameters<CodeMirrorControl['registerCommand']>[1]) =>
                commands.set(name, callback),
        } as unknown as CodeMirrorControl;
        contentScript({
            pluginId: 'test-plugin',
            contentScriptId: 'test',
            postMessage: vi.fn().mockResolvedValue({}),
        }).plugin(control);
        return commands;
    }

    afterEach(() => view.destroy());

    it.each([original, original.slice(1)])('captures the note and full link with the context: %s', (doc) => {
        const commands = setup(doc);
        const contexts = commands.get(GET_CONTEXT_AT_CURSOR_COMMAND)!() as LinkContext[];
        expect(contexts[0]).toMatchObject({
            noteId: 'note-a',
            markdownLinkFrom: 0,
            markdownLinkTo: doc.length,
            expectedText: doc,
        });
    });

    it('updates only the label when the note and full link still match', () => {
        const commands = setup();
        expect(commands.get(BATCH_REPLACE_COMMAND)!([replacement], guard)).toBe(true);
        expect(view.state.doc.toString()).toBe(`![Beach](:/${resourceId} "Photo")`);
    });

    it('rejects another note even when the complete link is identical', () => {
        const commands = setup(original, 'note-b');
        expect(commands.get(BATCH_REPLACE_COMMAND)!([replacement], guard)).toBe(false);
        expect(view.state.doc.toString()).toBe(original);
    });

    it('rejects a changed resource URL even when the label and offsets match', () => {
        const changed = original.replace(resourceId, 'b'.repeat(32));
        const commands = setup(changed);
        expect(commands.get(BATCH_REPLACE_COMMAND)!([replacement], guard)).toBe(false);
        expect(view.state.doc.toString()).toBe(changed);
    });

    it('protects an empty label from insertion after switching notes', () => {
        const doc = `![](:/${resourceId})`;
        const commands = setup(doc, 'note-b');
        expect(
            commands.get(BATCH_REPLACE_COMMAND)!([{ from: 2, to: 2, text: 'Beach', expectedText: '' }], {
                ...guard,
                to: doc.length,
                expectedText: doc,
            })
        ).toBe(false);
        expect(view.state.doc.toString()).toBe(doc);
    });
});

describe('contentScript selection mapping', () => {
    it('preserves relative offsets by default when a replacement expands', () => {
        const replacements = [
            {
                from: 4,
                to: 23,
                text: '[Example](https://example.com)',
            },
        ];

        expect(mapPositionThroughReplacements(4, replacements)).toBe(4);
        expect(mapPositionThroughReplacements(23, replacements)).toBe(23);
    });

    it('expands selection endpoints at link-title replacement boundaries', () => {
        const replacements = [
            {
                from: 4,
                to: 23,
                text: '[Example](https://example.com)',
                selectionBehavior: 'expand' as const,
            },
        ];

        expect(mapPositionThroughReplacements(4, replacements)).toBe(4);
        expect(mapPositionThroughReplacements(23, replacements)).toBe(34);
    });

    it('maps positions after expanded replacements by the full length delta', () => {
        const replacements = [
            {
                from: 4,
                to: 23,
                text: '[Example](https://example.com)',
                selectionBehavior: 'expand' as const,
            },
        ];

        expect(mapPositionThroughReplacements(30, replacements)).toBe(41);
    });
});
