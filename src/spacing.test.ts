import { expect, test } from 'vitest';

import { format } from './index.ts';

// format a single statement and drop the trailing newline for easy comparison
const fmt = (source: string): string => format(source).replace(/\n$/, '');

test('binary operators get spaces, unary and prefix operators do not', () => {
	expect(fmt('a=b+c*d;')).toMatchInlineSnapshot(`"a = b + c * d;"`);
	expect(fmt('const y=-x;')).toMatchInlineSnapshot(`"const y = -x;"`);
	expect(fmt('const z=!flag;')).toMatchInlineSnapshot(`"const z = !flag;"`);
	expect(fmt('const w=~bits;')).toMatchInlineSnapshot(`"const w = ~bits;"`);
	expect(fmt('const n=a- -b;')).toMatchInlineSnapshot(`"const n = a - -b;"`);
});

test('postfix updates and non-null assertions bind tightly', () => {
	expect(fmt('i++;')).toMatchInlineSnapshot(`"i++;"`);
	expect(fmt('const v=arr[i]!/d;')).toMatchInlineSnapshot(`"const v = arr[i]! / d;"`);
});

test('keywords take a space; calls and indexing do not', () => {
	expect(fmt('return typeof x;')).toMatchInlineSnapshot(`"return typeof x;"`);
	expect(fmt('const m=new Map();')).toMatchInlineSnapshot(`"const m = new Map();"`);
	expect(fmt('foo(a,b);')).toMatchInlineSnapshot(`"foo(a, b);"`);
	expect(fmt('const e=arr[0];')).toMatchInlineSnapshot(`"const e = arr[0];"`);
});

test('ternary and optional members', () => {
	expect(fmt('const r=a?b:c;')).toMatchInlineSnapshot(`"const r = a ? b : c;"`);
	expect(fmt('const t:{x?:number}=v;')).toMatchInlineSnapshot(`"const t: { x?: number } = v;"`);
});

test('objects, arrays, spreads, arrows, decorators', () => {
	expect(fmt('const o={a:1,b:2};')).toMatchInlineSnapshot(`"const o = { a: 1, b: 2 };"`);
	expect(fmt('const a=[...x,...y];')).toMatchInlineSnapshot(`"const a = [...x, ...y];"`);
	expect(fmt('const f=(a,b)=>a+b;')).toMatchInlineSnapshot(`"const f = (a, b) => a + b;"`);
});

test('a generator star binds to its keyword', () => {
	expect(fmt('function*g(){yield 1;}')).toMatchInlineSnapshot(`
		"function* g() {
			yield 1;
		}"
	`);
});

test('member access on a numeric literal keeps a space so it does not re-lex', () => {
	// `1 .toString()` must not become `1.toString()` (which lexes as `1.` then a name)
	expect(fmt('const s = 1 .toString();')).toMatchInlineSnapshot(`"const s = 1 .toString();"`);
	expect(fmt('const t = 3.14 .x;')).toMatchInlineSnapshot(`"const t = 3.14 .x;"`);
});

test('spacing around < and > is left as written (generic vs comparison is ambiguous)', () => {
	// generic stays tight, comparison stays as the author spaced it
	expect(fmt('const m=new Map<string,number>();')).toMatchInlineSnapshot(
		`"const m = new Map<string, number>();"`,
	);
	expect(fmt('const b=a<n;')).toMatchInlineSnapshot(`"const b = a<n;"`);
	expect(fmt('const c=a < n;')).toMatchInlineSnapshot(`"const c = a < n;"`);
});
