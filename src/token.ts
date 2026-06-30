/**
 * a lexical token covering a half-open `[start, end)` range of the source.
 *
 * the token stream is lossless: every byte of the source belongs to exactly one token, including whitespace
 * runs and comments. literal tokens (`string`, `regex`, the template pieces) are opaque — their text is never
 * reformatted — so the formatter only ever rewrites the whitespace between tokens, never their interiors.
 */
export interface Token {
	end: number;
	/** a bit set of {@link TokenFlag} markers, or 0 when the token carries none. */
	flags: number;
	kind: TokenKind;
	/** for a `whitespace` token: the number of line terminators in the run; 0 for every other kind. */
	newlines: number;
	start: number;
}

/**
 * the marker bits packed into {@link Token.flags}. they live in one integer, rather than separate boolean
 * fields added to a token on demand, so every token shares a single object shape and the hot readers over the
 * stream stay monomorphic.
 */
export const TokenFlag = {
	/** an opening or closing brace that delimits a block rather than an object literal. */
	block: 1,
	/** a `:` that ends a switch `case`/`default` label, so the following `{` opens a block. */
	caseColon: 2,
	/** a closing paren whose matching `(` followed a control keyword (`if`/`for`/`while`/...). */
	keywordParen: 4,
} as const;

/**
 * the lexical class of a {@link Token}.
 *
 * a template literal with interpolations is split into `templateHead` (`` `…${ ``), zero or more
 * `templateMiddle` (`} … ${`), and `templateTail` (`} … ` ``); the interpolated expressions in between are
 * ordinary tokens. a template with no interpolations is a single `template` token.
 */
export type TokenKind =
	| 'blockComment'
	| 'identifier'
	| 'lineComment'
	| 'number'
	| 'punctuator'
	| 'regex'
	| 'string'
	| 'template'
	| 'templateHead'
	| 'templateMiddle'
	| 'templateTail'
	| 'whitespace';

/** the closing punctuator that matches each opening bracket. */
export const closerFor: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
