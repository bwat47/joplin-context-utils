import { vi } from 'vitest';
import { getViewerTaskContext, receiveViewerMessage } from './viewerContextMenu';
import { RESOLVE_VIEWER_TASKS_COMMAND } from './contentScripts/contentScript';
import type { TaskContext } from './types';

const apiMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('api', () => ({
    default: { commands: { execute: apiMocks.execute } },
}));

vi.mock('./logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const execute = apiMocks.execute;
const tasks = [
    { line: 2, checked: false },
    { line: 3, checked: true },
];
const taskContext: TaskContext = {
    contextType: 'task',
    tasks: [
        { lineText: '- [ ] first', checked: false, from: 10, to: 21 },
        { lineText: '- [x] second', checked: true, from: 22, to: 34 },
    ],
    checkedCount: 1,
    uncheckedCount: 1,
};
let clock = Date.now();

describe('getViewerTaskContext', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        clock += 10_000;
        vi.setSystemTime(new Date(clock));
        execute.mockReset();
        execute.mockResolvedValue(taskContext);
        // Drain any message a previous test left behind.
        vi.advanceTimersByTime(1000);
        const drained = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(1000);
        await drained;
        execute.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves tasks from a message that arrived before the menu', async () => {
        receiveViewerMessage({ tasks, clickedAt: Date.now() });

        await expect(getViewerTaskContext(Date.now())).resolves.toEqual(taskContext);
        expect(execute).toHaveBeenCalledWith('editor.execCommand', {
            name: RESOLVE_VIEWER_TASKS_COMMAND,
            args: [tasks],
        });
    });

    it('waits for a message that arrives after the menu request', async () => {
        const clickedAt = Date.now();
        const result = getViewerTaskContext(clickedAt);
        await vi.advanceTimersByTimeAsync(50);
        receiveViewerMessage({ tasks, clickedAt });

        await expect(result).resolves.toEqual(taskContext);
    });

    it('returns null when the editor cannot resolve the tasks', async () => {
        execute.mockResolvedValue(null);
        receiveViewerMessage({ tasks, clickedAt: Date.now() });

        await expect(getViewerTaskContext(Date.now())).resolves.toBeNull();
    });

    it('returns null when the editor command fails', async () => {
        execute.mockRejectedValue(new Error('No editor'));
        receiveViewerMessage({ tasks, clickedAt: Date.now() });

        await expect(getViewerTaskContext(Date.now())).resolves.toBeNull();
    });

    it('does not touch the editor for a right-click without selected tasks', async () => {
        receiveViewerMessage({ tasks: null, clickedAt: Date.now() });

        await expect(getViewerTaskContext(Date.now())).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('ignores invalid task lists', async () => {
        receiveViewerMessage({ tasks: [{ line: -1, checked: false }], clickedAt: Date.now() });

        await expect(getViewerTaskContext(Date.now())).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('gives up when no message arrives', async () => {
        const result = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('ignores a message too old to belong to this menu', async () => {
        receiveViewerMessage({ tasks, clickedAt: Date.now() });
        vi.advanceTimersByTime(1000);

        const result = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('uses each message for one menu only', async () => {
        receiveViewerMessage({ tasks, clickedAt: Date.now() });
        await getViewerTaskContext(Date.now());
        execute.mockClear();

        const second = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(1000);

        await expect(second).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('discards a message that arrives just after its menu request timed out', async () => {
        const clickedAt = Date.now();
        const first = getViewerTaskContext(clickedAt);
        await vi.advanceTimersByTimeAsync(301);
        await expect(first).resolves.toBeNull();

        receiveViewerMessage({ tasks, clickedAt });
        const second = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(301);

        await expect(second).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });

    it('gives a click to the later of two waiting menus', async () => {
        const first = getViewerTaskContext(Date.now());
        await vi.advanceTimersByTimeAsync(50);
        const clickedAt = Date.now();
        const second = getViewerTaskContext(clickedAt);

        receiveViewerMessage({ tasks, clickedAt });

        await expect(first).resolves.toBeNull();
        await expect(second).resolves.toEqual(taskContext);
    });

    it('does not let an older delayed message replace a newer click', async () => {
        const olderClickAt = Date.now();
        vi.advanceTimersByTime(10);
        const newerClickAt = Date.now();
        receiveViewerMessage({ tasks: null, clickedAt: newerClickAt });
        receiveViewerMessage({ tasks, clickedAt: olderClickAt });

        await expect(getViewerTaskContext(Date.now())).resolves.toBeNull();
        expect(execute).not.toHaveBeenCalled();
    });
});
