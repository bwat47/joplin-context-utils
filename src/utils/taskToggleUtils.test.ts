import { TaskInfo } from '../types';
import { getTaskToggleMenuLabel, getTaskTogglePlan } from './taskToggleUtils';

function task(checked: boolean): TaskInfo {
    const lineText = checked ? '- [x] Task' : '- [ ] Task';
    return {
        lineText,
        checked,
        from: 0,
        to: lineText.length,
    };
}

describe('getTaskTogglePlan', () => {
    it('checks unchecked-only tasks', () => {
        const tasks = [task(false), task(false)];
        const plan = getTaskTogglePlan(tasks);

        expect(plan.targetChecked).toBe(true);
        expect(plan.tasksToUpdate).toEqual(tasks);
    });

    it('unchecks checked-only tasks', () => {
        const tasks = [task(true), task(true)];
        const plan = getTaskTogglePlan(tasks);

        expect(plan.targetChecked).toBe(false);
        expect(plan.tasksToUpdate).toEqual(tasks);
    });

    it('checks only unchecked tasks in mixed selections', () => {
        const checkedTask = task(true);
        const uncheckedTask = task(false);
        const plan = getTaskTogglePlan([checkedTask, uncheckedTask]);

        expect(plan.targetChecked).toBe(true);
        expect(plan.tasksToUpdate).toEqual([uncheckedTask]);
    });
});

describe('getTaskToggleMenuLabel', () => {
    it('labels a single unchecked task as checkable', () => {
        expect(getTaskToggleMenuLabel([task(false)])).toBe('Check Task');
    });

    it('labels a single checked task as uncheckable', () => {
        expect(getTaskToggleMenuLabel([task(true)])).toBe('Uncheck Task');
    });

    it('shows the toggled count for unchecked-only selections', () => {
        expect(getTaskToggleMenuLabel([task(false), task(false)])).toBe('Toggle Tasks (2)');
    });

    it('shows the toggled count for checked-only selections', () => {
        expect(getTaskToggleMenuLabel([task(true), task(true)])).toBe('Toggle Tasks (2)');
    });

    it('shows only the tasks that will change for mixed selections', () => {
        expect(getTaskToggleMenuLabel([task(true), task(false), task(false)])).toBe('Toggle Tasks (2)');
    });
});
