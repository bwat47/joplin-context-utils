import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import { VIEWER_CONTENT_SCRIPT_ID } from '../viewerTasks';

const script = readFileSync(resolve(process.cwd(), 'src/contentScripts/viewerContextMenu.js'), 'utf8');

function renderTask(line: number, label: string, checked: boolean, nested = ''): string {
    const id = `md-checkbox-${line}`;
    return (
        `<li class="md-checkbox joplin-checkbox maps-to-line" source-line="${line}" source-line-end="${line + 1}">` +
        `<div class="checkbox-wrapper"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}>` +
        `<label id="cb-label-${id}" for="${id}">${label}</label></div>${nested}</li>`
    );
}

// Mirrors Joplin's viewer output for task lists, including a nested task list.
const VIEWER_HTML =
    '<h3 class="maps-to-line" source-line="0">Heading</h3>' +
    '<ul data-is-checklist="1">' +
    renderTask(2, 'First', true) +
    renderTask(3, 'Parent', false, `<ul data-is-checklist="1">${renderTask(4, 'Child', true)}</ul>`) +
    renderTask(5, 'Last', false) +
    '</ul>';

const postMessage = vi.fn<(id: string, message: unknown) => Promise<void>>(() => Promise.resolve());

const label = (text: string): Text =>
    [...document.querySelectorAll('label')].find((element) => element.textContent === text)!.firstChild as Text;

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
}

function rightClick(): unknown {
    postMessage.mockClear();
    label('First').parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0]).toBe(VIEWER_CONTENT_SCRIPT_ID);
    return postMessage.mock.calls[0][1];
}

describe('viewerContextMenu.js', () => {
    beforeAll(() => {
        Object.assign(window, { webviewApi: { postMessage } });
        window.eval(script);
    });

    beforeEach(() => {
        document.body.innerHTML = VIEWER_HTML;
        window.getSelection()!.removeAllRanges();
    });

    it('reports every task whose text the selection covers, with its rendered state', () => {
        select(label('First'), 2, label('Last'), 2);

        expect(rightClick()).toEqual({
            tasks: [
                { line: 2, checked: true },
                { line: 3, checked: false },
                { line: 4, checked: true },
                { line: 5, checked: false },
            ],
            clickedAt: expect.any(Number),
        });
    });

    it('does not report a parent task when only its nested task is selected', () => {
        select(label('Child'), 0, label('Child'), 5);

        expect(rightClick()).toEqual({ tasks: [{ line: 4, checked: true }], clickedAt: expect.any(Number) });
    });

    it('ignores a task the selection only touches at its start', () => {
        // Ends at the start of the last task's wrapper, as a triple-click selection can.
        const lastWrapper = label('Last').parentElement!.parentElement!;
        select(label('First'), 0, lastWrapper, 0);

        expect((rightClick() as { tasks: { line: number }[] }).tasks.map((task) => task.line)).toEqual([2, 3, 4]);
    });

    it('reports null tasks when the selection covers no task', () => {
        const heading = document.querySelector('h3')!.firstChild!;
        select(heading, 0, heading, 4);

        expect(rightClick()).toEqual({ tasks: null, clickedAt: expect.any(Number) });
    });

    it('reports null tasks without a selection', () => {
        expect(rightClick()).toEqual({ tasks: null, clickedAt: expect.any(Number) });
    });
});
