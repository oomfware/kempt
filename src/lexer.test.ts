import { expect, test } from 'vitest';

import { tokenize } from './lexer.ts';
import { type Token, TokenFlag } from './token.ts';

const slice = (source: string, t: Token): string => source.slice(t.start, t.end);

// significant tokens as [kind, text] pairs
const sig = (source: string): Array<[string, string]> =>
	tokenize(source)
		.filter((t) => t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment')
		.map((t) => [t.kind, slice(source, t)]);

// true when the source contains a regex token with the given text
const hasRegex = (source: string, text: string): boolean =>
	tokenize(source).some((t) => t.kind === 'regex' && slice(source, t) === text);

// true when the source contains a bare `/` division punctuator
const hasDivision = (source: string): boolean =>
	tokenize(source).some((t) => t.kind === 'punctuator' && slice(source, t) === '/');

test('lossless: tokens tile the whole source contiguously', () => {
	const samples = ['const x = 1;\n\tfoo(`a${b}c`, /re/g);\n', 'if (x) {} else {}\n', '﻿const y = 2;\n'];
	for (const source of samples) {
		const tokens = tokenize(source);
		let at = 0;
		for (const t of tokens) {
			expect(t.start).toBe(at);
			at = t.end;
		}
		expect(at).toBe(source.length);
	}
});

test('regex vs division', () => {
	expect(hasRegex('if (x) /re/g.test(y);', '/re/g')).toBe(true);
	expect(hasDivision('f() / 2;')).toBe(true);
	expect(hasDivision('a++ / b;')).toBe(true);
	expect(hasDivision('3.2 / x;')).toBe(true);
	expect(hasRegex('const r = /re/;', '/re/')).toBe(true);
	expect(hasRegex('return /re/;', '/re/')).toBe(true);
	expect(hasRegex('[1].map((x) => /re/);', '/re/')).toBe(true);
	expect(hasRegex('for (const x of /re/) {}', '/re/')).toBe(true);
	expect(hasRegex('a / /re/;', '/re/')).toBe(true);
	expect(hasDivision('typeof x / y;')).toBe(true);
	expect(hasDivision('a.b / c;')).toBe(true);
	// class heritage is an expression position, so `/` after `extends` is a regex
	expect(hasRegex('class C extends /x/.constructor {}', '/x/')).toBe(true);
	// a `{` at statement start is a block, so the following `/` begins a regex
	expect(hasRegex('{}\n/re/.test(x);', '/re/')).toBe(true);
});

test('TS postfix non-null assertion vs prefix not', () => {
	expect(hasDivision('arr[i]! / 2;')).toBe(true);
	expect(hasDivision('foo()! / bar;')).toBe(true);
	expect(hasRegex('return !/re/.test(x);', '/re/')).toBe(true);
});

test('optional chain vs ternary with leading-dot number', () => {
	expect(sig('a?.b')).toEqual([
		['identifier', 'a'],
		['punctuator', '?.'],
		['identifier', 'b'],
	]);
	expect(sig('a ? .5 : b')).toEqual([
		['identifier', 'a'],
		['punctuator', '?'],
		['number', '.5'],
		['punctuator', ':'],
		['identifier', 'b'],
	]);
});

test('template pieces and nesting', () => {
	expect(sig('`abc`')).toEqual([['template', '`abc`']]);
	expect(sig('`a${b}c`')).toEqual([
		['templateHead', '`a${'],
		['identifier', 'b'],
		['templateTail', '}c`'],
	]);
	// object brace inside an interpolation
	expect(sig('`${ {a:1} }`')).toEqual([
		['templateHead', '`${'],
		['punctuator', '{'],
		['identifier', 'a'],
		['punctuator', ':'],
		['number', '1'],
		['punctuator', '}'],
		['templateTail', '}`'],
	]);
	// nested template inside an interpolation
	expect(sig('`a${`x${y}z`}b`')).toEqual([
		['templateHead', '`a${'],
		['templateHead', '`x${'],
		['identifier', 'y'],
		['templateTail', '}z`'],
		['templateTail', '}b`'],
	]);
});

test('numbers, identifiers, decorators', () => {
	expect(sig('0xff + 1_000 + 1e-9 + 10n')).toEqual([
		['number', '0xff'],
		['punctuator', '+'],
		['number', '1_000'],
		['punctuator', '+'],
		['number', '1e-9'],
		['punctuator', '+'],
		['number', '10n'],
	]);
	expect(sig('this.#priv')).toEqual([
		['identifier', 'this'],
		['punctuator', '.'],
		['identifier', '#priv'],
	]);
	expect(sig('@Foo class X {}')).toEqual([
		['punctuator', '@'],
		['identifier', 'Foo'],
		['identifier', 'class'],
		['identifier', 'X'],
		['punctuator', '{'],
		['punctuator', '}'],
	]);
});

test('brace block vs object-literal classification', () => {
	const blockOf = (source: string): boolean => {
		const brace = tokenize(source).find((t) => t.kind === 'punctuator' && slice(source, t) === '{');
		return brace !== undefined && (brace.flags & TokenFlag.block) !== 0;
	};
	expect(blockOf('function f() { return 1; }')).toBe(true);
	expect(blockOf('if (x) { y(); }')).toBe(true);
	expect(blockOf('class A { }')).toBe(true);
	expect(blockOf('const o = { a: 1 };')).toBe(false);
	expect(blockOf('foo({ a: 1 });')).toBe(false);
	// a `{` at the start of the program is a block, never an object literal
	expect(blockOf('{ x(); }')).toBe(true);
});

test('an unterminated regex is division, since a regex cannot span lines', () => {
	// in regex position, `/a` with no closing slash before the newline is `/`
	// then `a` (a division), not a regex that swallows the next line
	expect(sig('x = /a\nb')).toEqual([
		['identifier', 'x'],
		['punctuator', '='],
		['punctuator', '/'],
		['identifier', 'a'],
		['identifier', 'b'],
	]);
	// a properly closed regex on one line still scans as a regex
	expect(hasRegex('x = /a/g;', '/a/g')).toBe(true);
});

test('comments are preserved as tokens', () => {
	const kinds = tokenize('// hi\n/* block */ x;').map((t) => t.kind);
	expect(kinds).toContain('lineComment');
	expect(kinds).toContain('blockComment');
});

test('string bodies keep line terminators that are valid inside them', () => {
	// U+2028/U+2029 are legal unescaped in a string and must not end it
	expect(sig('const s = "a b";')).toEqual([
		['identifier', 'const'],
		['identifier', 's'],
		['punctuator', '='],
		['string', '"a b"'],
		['punctuator', ';'],
	]);
	// a `\` + CRLF line continuation is one terminator sequence, consumed whole
	expect(sig("'a\\\r\nb'")).toEqual([['string', "'a\\\r\nb'"]]);
	// a `\` + LF line continuation likewise stays within the string
	expect(sig("'a\\\nb'")).toEqual([['string', "'a\\\nb'"]]);
});

test('identifiers may start with a unicode escape', () => {
	expect(sig('const \\u0061 = 1;')).toEqual([
		['identifier', 'const'],
		['identifier', '\\u0061'],
		['punctuator', '='],
		['number', '1'],
		['punctuator', ';'],
	]);
	// the `\u{…}` code-point form, both leading and mid-identifier
	expect(sig('\\u{61}b\\u{62}')).toEqual([['identifier', '\\u{61}b\\u{62}']]);
});

test('a `#!` hashbang at the start of the source is a line comment', () => {
	const tokens = tokenize('#!/usr/bin/env node\nx;');
	expect(tokens[0].kind).toBe('lineComment');
	expect(slice('#!/usr/bin/env node\nx;', tokens[0])).toBe('#!/usr/bin/env node');
	// `#` elsewhere is still a private name, not a comment
	expect(sig('a.#b')).toEqual([
		['identifier', 'a'],
		['punctuator', '.'],
		['identifier', '#b'],
	]);
});
