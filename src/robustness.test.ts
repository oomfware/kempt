import { expect, test } from 'vitest';

import { build } from './build.ts';
import { propagateBreaks } from './doc.ts';
import { format } from './index.ts';
import { tokenize } from './lexer.ts';

const codeTokens = (source: string): string[] =>
	tokenize(source)
		.filter((t) => t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment')
		.map((t) => source.slice(t.start, t.end));

// syntax kempt is not designed for — proposals at every stage, and Flow. the bar
// is not pretty output: only that the formatter never throws, is idempotent, and
// never drops or merges a token (so the result still "looks fine", never broken)
const exotic = [
	// pipeline operator, F# and Hack variants
	'const r = value |> double |> increment;',
	'const r = value |> double(%) |> (x => x + 1)(%);',
	'const r = x |> await # |> y;',
	// decorators beyond classes and accessors
	'class C { @logged accessor x = 1; method(@inject dep) {} }',
	'@decorator @another export class D {}',
	// do and async do expressions
	'const x = do { if (cond) { 1; } else { 2; } };',
	'const y = async do { await fetch(url); };',
	// record and tuple
	'const rec = #{ a: 1, b: #[2, 3] };',
	'const tup = #[1, 2, #{ x: 0 }];',
	// negated in / instanceof
	'if (key !in obj) { handle(); }',
	'if (value !instanceof Ctor) { reject(); }',
	// pattern matching and extractors
	'const out = match (shape) { when ({ kind: "circle" }): area(); when _: 0; };',
	'const Point(x, y) = origin;',
	// this-binding (bind operator)
	'const bound = obj::method;',
	'promise.then(::console.log);',
	'const piped = array::map(fn)::filter(pred);',
	// Flow
	'function f(x: ?number): string %checks { return ""; }',
	'opaque type ID = number;',
	'type Obj = { +readOnly: number, -writeOnly: string };',
	'const x: $ReadOnlyArray<number> = [1, 2, 3];',
	'declare module "m" { declare export default function f(): void; }',
];

test('never throws on exotic syntax', () => {
	for (const source of exotic) {
		expect(() => format(source), JSON.stringify(source)).not.toThrow();
	}
});

test('is idempotent on exotic syntax', () => {
	for (const source of exotic) {
		const once = format(source);
		expect(format(once), `idempotent: ${JSON.stringify(source)}`).toBe(once);
	}
});

test('preserves every token on exotic syntax', () => {
	for (const source of exotic) {
		expect(codeTokens(format(source)), `tokens: ${JSON.stringify(source)}`).toEqual(codeTokens(source));
	}
});

// inputs that once changed meaning: a `/` mis-spaced as division reshapes a
// regex, a mis-scanned string body splits the literal, and unicode-escape
// identifiers or a hashbang were torn apart
const meaningPreserving = [
	'#!/usr/bin/env node\nconsole.log(1);',
	'class C extends /x/.constructor {}',
	'const \\u0061 = 1;',
	'const \\u{61} = 2;',
	"const s = 'a b';",
	"const s = 'a\\\nb';",
	"const s = 'a\\\r\nb';",
	'for (;;) { run(); }',
	'function f(a?, b?) {}',
	'interface I { m?(): void; p?: number; }',
	'{}\n/re/.test(x);',
];

test('never drops or merges a token on meaning-sensitive input', () => {
	for (const source of meaningPreserving) {
		expect(() => format(source), JSON.stringify(source)).not.toThrow();
		const once = format(source);
		expect(format(once), `idempotent: ${JSON.stringify(source)}`).toBe(once);
		expect(codeTokens(once), `tokens: ${JSON.stringify(source)}`).toEqual(codeTokens(source));
	}
});

test('does not overflow the stack on deeply nested input', () => {
	const depth = 50_000;
	const deep = `const x = ${'('.repeat(depth)}0${')'.repeat(depth)};`;
	// the layout builder and break propagation must scale to nesting depth without
	// recursing (the printer is already iterative). a depth past the old recursive
	// limit (~5000) would have overflowed the call stack. these run in
	// milliseconds; full formatting is skipped because the printer's per-group fit
	// check makes laying out pathological depth an O(depth^2) cost, not a crash
	expect(() => propagateBreaks(build(tokenize(deep), deep))).not.toThrow();
});
