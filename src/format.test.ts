import { expect, test } from 'vitest';

import { format } from './index.ts';
import { tokenize } from './lexer.ts';

// the non-whitespace, non-comment token texts — the formatter must preserve these exactly
const codeTokens = (source: string): string[] =>
	tokenize(source)
		.filter((t) => t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment')
		.map((t) => source.slice(t.start, t.end));

const samples = [
	'const x=1;const y=2;',
	'import {a,b} from "x";import c from "y";export function f(){return a+b;}',
	'function f(a,b){if(a){return b;}else{return a;}}',
	'const o={a:1,b:2,c:3};',
	'class A{method(){return 1;}field=2;}',
	'foo(()=>{bar();baz();});',
	'const r=/ab+c/g;const s=`a${b}c`;',
	'',
];

test('formats and is idempotent and preserves code tokens', () => {
	for (const source of samples) {
		const once = format(source);
		const twice = format(once);
		expect(twice, `idempotent: ${JSON.stringify(source)}`).toBe(once);
		if (source.trim().length > 0) {
			expect(codeTokens(once), `tokens preserved: ${JSON.stringify(source)}`).toEqual(codeTokens(source));
			expect(once.endsWith('\n'), `trailing newline: ${JSON.stringify(source)}`).toBe(true);
		}
	}
});

test('golden: a small module', () => {
	const source =
		'import {a, b} from "x";export function add(first, second) {const sum = first + second;return sum;}';
	expect(format(source)).toMatchInlineSnapshot(`
		"import { a, b } from "x";

		export function add(first, second) {
			const sum = first + second;
			return sum;
		}
		"
	`);
});

test('golden: a declaration block expands one member per line, generics stay inline', () => {
	const source = 'interface Props { id: number; name: string; meta?: Record<string, unknown>; }';
	expect(format(source)).toMatchInlineSnapshot(`
		"interface Props {
			id: number;
			name: string;
			meta?: Record<string, unknown>;
		}
		"
	`);
});

test('golden: a callback argument hugs at a single indent level', () => {
	const source = 'items.forEach((item) => { process(item); save(item); });';
	expect(format(source)).toMatchInlineSnapshot(`
		"items.forEach((item) => {
			process(item);
			save(item);
		});
		"
	`);
});

test('golden: nested callbacks each add exactly one level', () => {
	const source = 'describe("a", () => { it("b", () => { expect(x).toBe(y); }); });';
	expect(format(source)).toMatchInlineSnapshot(`
		"describe("a", () => {
			it("b", () => {
				expect(x).toBe(y);
			});
		});
		"
	`);
});

test('golden: an overflowing chain breaks the arguments of its widest call', () => {
	const source = 'const out = source.filter((x) => x.active).map((x) => x.value).reduce((a, b) => a + b, 0);';
	expect(format(source)).toMatchInlineSnapshot(`
		"const out = source.filter((x) => x.active).map((x) => x.value).reduce(
			(a, b) => a + b,
			0
		);
		"
	`);
});

test('golden: a short chain stays on one line', () => {
	expect(format('const n = list.map((x) => x).length;')).toMatchInlineSnapshot(`
		"const n = list.map((x) => x).length;
		"
	`);
});

test('golden: trailing line comments stay on their line and force a break', () => {
	expect(format('const o = {\na: 1, // first\nb: 2, // second\n};')).toMatchInlineSnapshot(`
		"const o = {
			a: 1, // first
			b: 2, // second
		};
		"
	`);
	expect(format('let n = 1; // count')).toMatchInlineSnapshot(`
		"let n = 1; // count
		"
	`);
});

test('preserves whitespace inside multi-line token interiors', () => {
	// the formatter canonicalises layout between tokens but never rewrites a
	// token's bytes, so whitespace sitting before a newline inside a comment,
	// block comment, or template literal survives verbatim — trimming it would
	// change a template literal's runtime value
	expect(format('const t = `a   \nb`;')).toBe('const t = `a   \nb`;\n');
	expect(format('const x = /* a   \n */ 1;')).toBe('const x = /* a   \n */ 1;\n');
	expect(format('// trailing   \nconst a = 1;')).toBe('// trailing   \nconst a = 1;\n');
});

test('never throws on the samples', () => {
	for (const source of samples) {
		expect(() => format(source)).not.toThrow();
	}
});
