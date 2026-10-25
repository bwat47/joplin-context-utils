import { mapPositionThroughReplacements } from './contentScript';

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
