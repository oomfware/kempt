/**
 * a lexical token covering a half-open `[start, end)` range of the source.
 *
 * the token stream is lossless: every byte of the source belongs to exactly one token, including whitespace
 * runs and comments. literal tokens (`string`, `regex`, the template pieces) are opaque — their text is never
 * reformatted — so the formatter only ever rewrites the whitespace between tokens, never their interiors.
 */
export interface Token {
	/** for an opening or closing brace: true when it delimits a block rather than an object literal. */
	block?: boolean;
	/**
	 * for a `:` punctuator: true when it ends a switch `case`/`default` label, so the following `{` opens a
	 * block.
	 */
	caseColon?: boolean;
	end: number;
	/** for a closing paren: true when the matching `(` followed a control keyword (`if`/`for`/`while`/...). */
	keywordParen?: boolean;
	kind: TokenKind;
	/** for a `whitespace` token: the number of line terminators in the run; 0 for every other kind. */
	newlines: number;
	start: number;
}

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
