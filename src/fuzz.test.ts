import fc from 'fast-check';
import { expect, test } from 'vitest';

import { format } from './index.ts';
import { tokenize } from './lexer.ts';

const codeTokens = (source: string): string[] =>
	tokenize(source)
		.filter((t) => t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment')
		.map((t) => source.slice(t.start, t.end));

interface Tok {
	text: string;
	word: boolean;
}

const w = (text: string): Tok => ({ text, word: true });
const p = (text: string): Tok => ({ text, word: false });

// concatenates tokens and token lists into a single list
const cat = (...parts: Array<Tok | Tok[]>): Tok[] => parts.flatMap((x) => (Array.isArray(x) ? x : [x]));

const ident = fc.constantFrom('a', 'b', 'foo', 'x', 'data', 'value').map((t): Tok[] => [w(t)]);
const literal = fc
	.constantFrom('0', '1', '42', '3.14', '"str"', '`tmpl`', 'true', 'null')
	.map((t): Tok[] => [/[a-z0-9]/i.test(t[0]) ? w(t) : p(t)]);
const binaryOp = fc
	.constantFrom('+', '-', '*', '/', '%', '<', '>', '===', '&&', '||', '??')
	.map((t): Tok[] => [p(t)]);

const commaSep = (items: Tok[][]): Tok[] => items.flatMap((it, k) => (k > 0 ? cat(p(','), it) : it));

// recursive arbitraries producing token lists for expressions and statements
const { statement } = fc.letrec<{ block: Tok[]; expr: Tok[]; statement: Tok[] }>((tie) => ({
	expr: fc.oneof(
		{ maxDepth: 4, withCrossShrink: true },
		fc.oneof(ident, literal),
		fc.tuple(tie('expr'), binaryOp, tie('expr')).map(([a, op, b]) => cat(a, op, b)),
		fc
			.tuple(ident, fc.array(tie('expr'), { maxLength: 3 }))
			.map(([f, args]) => cat(f, p('('), commaSep(args), p(')'))),
		fc.array(tie('expr'), { maxLength: 4 }).map((items) => cat(p('['), commaSep(items), p(']'))),
		fc
			.array(fc.tuple(ident, tie('expr')), { maxLength: 3 })
			.map((entries) => cat(p('{'), commaSep(entries.map(([k, v]) => cat(k, p(':'), v))), p('}'))),
		fc.tuple(ident, tie('expr')).map(([param, body]) => cat(p('('), param, p(')'), p('=>'), body)),
		fc.tuple(tie('expr'), ident).map(([obj, name]) => cat(obj, p('.'), name)),
	),
	statement: fc.oneof(
		{ maxDepth: 3 },
		fc.tuple(ident, tie('expr')).map(([name, value]) => cat(w('const'), name, p('='), value, p(';'))),
		tie('expr').map((e) => cat(e, p(';'))),
		fc.tuple(tie('expr'), tie('block')).map(([c, b]) => cat(w('if'), p('('), c, p(')'), p('{'), b, p('}'))),
		fc
			.tuple(ident, ident, tie('block'))
			.map(([name, param, b]) => cat(w('function'), name, p('('), param, p(')'), p('{'), b, p('}'))),
	),
	block: fc.array(tie('statement'), { maxLength: 3 }).map((stmts) => stmts.flat()),
}));

// kempt assumes valid, non-ASI input; only on such input are its
// meaning-preserving invariants (idempotence, token preservation) guaranteed.
// on invalid token soup, collapsing whitespace can legitimately re-lex — e.g. a
// `/` that was division only because a newline split it becomes a regex once put
// on one line — so those invariants are asserted only when the source parses
const parses = (source: string): boolean => {
	try {
		// eslint-disable-next-line no-new, typescript/no-implied-eval
		new Function(source);
		return true;
	} catch {
		return false;
	}
};

const gaps = ['', ' ', '  ', '\n', '\t', ' \n\t'];

// joins tokens with caller-chosen gaps, always keeping a space between two words
// so the rendered source tokenizes back to the same tokens
const render = (tokens: Tok[], choices: number[]): string => {
	let out = tokens.length > 0 ? tokens[0].text : '';
	for (let k = 1; k < tokens.length; k++) {
		const choice = choices[k % choices.length];
		const gap = tokens[k - 1].word && tokens[k].word ? gaps[1 + (choice % 5)] : gaps[choice % gaps.length];
		out += gap + tokens[k].text;
	}
	return out;
};

test('fuzz: never throws, idempotent, token-preserving', () => {
	fc.assert(
		fc.property(
			fc.array(statement, { minLength: 1, maxLength: 6 }).map((s) => s.flat()),
			fc.array(fc.nat(5), { minLength: 1, maxLength: 8 }),
			(tokens, choices) => {
				const source = render(tokens, choices);
				// never throws, on either pass, whatever the input
				const once = format(source);
				const twice = format(once);
				// idempotence and token preservation hold only for valid input:
				// on invalid token soup, collapsing whitespace can re-lex (see parses)
				if (parses(source)) {
					expect(twice).toBe(once);
					expect(codeTokens(once)).toEqual(codeTokens(source));
				}
			},
		),
		{ numRuns: 2000 },
	);
});
