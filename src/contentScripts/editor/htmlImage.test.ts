import { findHtmlImage } from './htmlImage';

describe('HTML image labels', () => {
    it.each([
        { attribute: 'alt="Tom &amp; Jerry"', plainText: 'Tom & Jerry' },
        { attribute: "ALT = 'Tom &#38; Jerry'", plainText: 'Tom & Jerry' },
        { attribute: 'alt=photo.png', plainText: 'photo.png' },
        { attribute: 'alt=""', plainText: '' },
        { attribute: 'alt', plainText: '' },
        { attribute: 'alt="a > b\nsecond line"', plainText: 'a > b\nsecond line' },
    ])('captures $attribute without changing other attributes', ({ attribute, plainText }) => {
        const html = `<img width="200" ${attribute} src=":/id" height="100" />`;
        const image = findHtmlImage(html)!;
        expect(image.src).toBe(':/id');
        expect(image.label.plainText).toBe(plainText);
        expect(html.slice(image.label.from, image.label.to)).toBe(attribute);
    });

    it.each(['src=":/id"', "SRC = ':/id'", 'src=:/id'])('inserts a missing alt immediately after %s', (attribute) => {
        const html = `<div></div><IMG width="200" ${attribute} height="100"/>`;
        const insertionPoint = html.indexOf(attribute) + attribute.length;
        expect(findHtmlImage(html, html.indexOf(attribute))?.label).toEqual({
            from: insertionPoint,
            to: insertionPoint,
            text: '',
            format: 'htmlAttributeInsertion',
            plainText: '',
        });
    });

    it('ignores attribute names embedded in quoted values or data attributes', () => {
        const html = `<img title="alt='fake' src='wrong'" data-alt="fake" src = ':/id'>`;
        const image = findHtmlImage(html)!;
        expect(image.src).toBe(':/id');
        expect(image.label.format).toBe('htmlAttributeInsertion');
    });

    it('returns no image when the cursor is outside its tag', () => {
        const html = '<div>text <img src=":/id"></div>';
        expect(findHtmlImage(html, 2)).toBeNull();
        expect(findHtmlImage(html, html.indexOf('src'))?.src).toBe(':/id');
    });

    it.each([
        `<!-- <img src=":/id" alt="fake"> -->`,
        `<div title='<img src=":/id" alt="fake">'>text</div>`,
        `<img-other src=":/id" alt="fake">`,
    ])('ignores image-like text in %s', (html) => {
        expect(findHtmlImage(html, html.indexOf(':/id'))).toBeNull();
    });
});
