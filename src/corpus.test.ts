import { expect, test } from 'vitest';

import { format } from './index.ts';
import { tokenize } from './lexer.ts';

const codeTokens = (source: string): string[] =>
	tokenize(source)
		.filter((t) => t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment')
		.map((t) => source.slice(t.start, t.end));

// a spread of realistic generated-code constructs; the invariants must hold for all
const corpus = [
	'const re = /[a-z]+/gi; const ok = a / b > 0;',
	'const t = `hello ${name}, you have ${count + 1} messages`;',
	'const m = new Map<string, number>(); const s = new Set<string>();',
	'const obj = { a: 1, b: [2, 3], c: { d: 4 }, e: () => 5 };',
	'function f<T extends object>(x: T): T { return x; }',
	'class Foo extends Bar { private x = 1; constructor() { super(); } get y() { return this.x; } }',
	'@Component({ selector: "app" }) export class App {}',
	'const r = cond ? doThing() : doOther();',
	'const v = obj?.a?.b?.c ?? fallback;',
	'try { risky(); } catch (e) { handle(e); } finally { cleanup(); }',
	'do { step(); } while (running);',
	'for (const [k, v] of Object.entries(map)) { console.log(k, v); }',
	'const { a, b, ...rest } = props; const [first, ...others] = list;',
	'export default function () { return 42; }',
	'const x = arr.filter((n) => n > 0).map((n) => n * 2);',
	'const big = veryLongName.someMethod(argOne, argTwo, argThree, argFour, argFive, argSixSeven);',
	'const nn = value!.property; const dd = arr[index]! / divisor;',
	'switch (kind) { case "a": return 1; case "b": return 2; default: return 0; }',
	'switch (kind) { case "a": { const v = load(); return v; } default: { return 0; } }',
	'const s = "a string with // not a comment and /* not either */";',
	'let n = 0xff_ff + 1_000_000 + 3.14e-10 + 42n;',
	'(function () { init(); })();',
	'const nested = foo(bar(baz(qux(deep(value)))));',
	'interface Props { id: number; name: string; tags: string[]; meta?: Record<string, unknown>; }',
	'type U = "a" | "b" | "c"; type Fn = (x: number, y: number) => number;',
	'import { a, b, c } from "mod"; import type { T } from "types"; export { a, b };',
	'const r = source.filter((x) => x.active).map((x) => x.value).reduce((a, b) => a + b, 0).join();',
	'promise.then((res) => { handle(res); }).catch((err) => { log(err); }).finally(() => done());',
	'describe("suite", () => { it("works", () => { expect(fn()).toBe(true); }); });',
];

test('never throws on any corpus input', () => {
	for (const source of corpus) {
		expect(() => format(source), JSON.stringify(source)).not.toThrow();
	}
});

test('is idempotent across the corpus', () => {
	for (const source of corpus) {
		const once = format(source);
		expect(format(once), `idempotent: ${JSON.stringify(source)}`).toBe(once);
	}
});

test('preserves every code token across the corpus', () => {
	for (const source of corpus) {
		expect(codeTokens(format(source)), `tokens: ${JSON.stringify(source)}`).toEqual(codeTokens(source));
	}
});
