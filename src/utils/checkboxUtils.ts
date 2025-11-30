/**
 * Utility functions for checkbox manipulation in task lists
 */

/**
 * Toggles a checkbox in a task list line
 * @param lineText - The complete line text containing the checkbox
 * @param toChecked - If true, checks the box ([ ] → [x]); if false, unchecks it ([x] → [ ])
 * @returns The line text with the checkbox toggled
 *
 * @example
 * toggleCheckboxInLine('- [ ] Task', true)  // Returns: '- [x] Task'
 * toggleCheckboxInLine('- [x] Done', false) // Returns: '- [ ] Done'
 */
export function toggleCheckboxInLine(lineText: string, toChecked: boolean): string {
    return toChecked ? lineText.replace(/\[ \]/, '[x]') : lineText.replace(/\[x\]/, '[ ]');
}
