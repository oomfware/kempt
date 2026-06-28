import { expect, test } from 'vitest';

import type { Doc, PrintOptions } from './doc.ts';
import { group, hardline, indent, line, printDoc, propagateBreaks, softline } from './doc.ts';

const defaults: PrintOptions = { indentWidth: 2, lineWidth: 80, useTabs: true };
const print = (doc: Doc, options: Partial<PrintOptions> = {}): string => {
	propagateBreaks(doc);
	return printDoc(doc, { ...defaults, ...options });
};

test('a group that fits stays flat', () => {
	expect(print(group(['a', line, 'b']))).toBe('a b');
});

test('a group that overflows breaks its lines', () => {
	expect(print(group(['aa', line, 'bb']), { lineWidth: 3 })).toBe('aa\nbb');
});

test('softline is nothing when flat and a newline when broken', () => {
	const doc = group(['(', indent([softline, 'x']), softline, ')']);
	expect(print(doc)).toBe('(x)');
	expect(print(doc, { lineWidth: 2 })).toBe('(\n\tx\n)');
});

test('hardline always breaks and forces the enclosing group', () => {
	expect(print(group(['a', hardline, 'b']))).toBe('a\nb');
});

test('nested indentation tracks depth with tabs', () => {
	const inner = group(['{', indent([hardline, 'b;']), hardline, '}']);
	const outer = group(['{', indent([hardline, 'a;', hardline, inner]), hardline, '}']);
	expect(print(outer)).toBe('{\n\ta;\n\t{\n\t\tb;\n\t}\n}');
});

test('indentation uses spaces when useTabs is false', () => {
	const doc = group(['(', indent([softline, 'x']), softline, ')']);
	expect(print(doc, { lineWidth: 2, useTabs: false })).toBe('(\n  x\n)');
});

test('an inner hardline propagates out and breaks an outer group', () => {
	// the outer group fits on one line by width, but the inner hardline forces it
	const doc = group(['a ', group(['b', hardline, 'c'])]);
	expect(print(doc)).toBe('a b\nc');
});
