import { checkCheckboxInLine, uncheckCheckboxInLine } from './checkboxUtils';

describe('checkbox updates', () => {
    it('checks a nested quoted task without changing its other brackets', () => {
        expect(checkCheckboxInLine('  > - [ ] Task [ ]')).toBe('  > - [x] Task [ ]');
    });

    it('unchecks a nested quoted task without changing its other brackets', () => {
        expect(uncheckCheckboxInLine('  > - [x] Task [x]')).toBe('  > - [ ] Task [x]');
    });

    it('leaves an already checked task unchanged when checking', () => {
        expect(checkCheckboxInLine('- [x] Done')).toBe('- [x] Done');
    });

    it('leaves an already unchecked task unchanged when unchecking', () => {
        expect(uncheckCheckboxInLine('- [ ] Task')).toBe('- [ ] Task');
    });

    it('does not check a later bracket when the task is already checked', () => {
        expect(checkCheckboxInLine('- [x] Done [ ]')).toBe('- [x] Done [ ]');
    });

    it('does not uncheck a later bracket when the task is already unchecked', () => {
        expect(uncheckCheckboxInLine('- [ ] Task [x]')).toBe('- [ ] Task [x]');
    });

    it('leaves a non-task line unchanged', () => {
        expect(checkCheckboxInLine('Some [ ] text')).toBe('Some [ ] text');
    });
});
