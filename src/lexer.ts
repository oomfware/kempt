import type { Token, TokenKind } from './token.ts';

// #region character classes

const Char = {
	backslash: 92,
	backtick: 96,
	bang: 33,
	bom: 0xfeff,
	closeBrace: 125,
	colon: 58,
	cr: 13,
	dollar: 36,
	dot: 46,
	doubleQuote: 34,
	hash: 35,
	lf: 10,
	ls: 0x2028,
	openBrace: 123,
	ps: 0x2029,
	question: 63,
	singleQuote: 39,
	slash: 47,
	star: 42,
	u: 117,
	underscore: 95,
} as const;

const isLineTerminator = (cc: number): boolean =>
	cc === Char.lf || cc === Char.cr || cc === Char.ls || cc === Char.ps;

const isWhiteSpace = (cc: number): boolean => {
	switch (cc) {
		case 0x09:
		case 0x0b:
		case 0x0c:
		case 0x20:
		case 0xa0:
		case 0x1680:
		case 0x202f:
		case 0x205f:
		case 0x3000:
		case Char.bom: {
			return true;
		}
		default: {
			return cc >= 0x2000 && cc <= 0x200a;
		}
	}
};

const isDigit = (cc: number): boolean => cc >= 48 && cc <= 57;

const isIdStart = (cc: number): boolean =>
	(cc >= 65 && cc <= 90) ||
	(cc >= 97 && cc <= 122) ||
	cc === Char.dollar ||
	cc === Char.underscore ||
	cc > 0x7f;

const isIdContinue = (cc: number): boolean => isIdStart(cc) || isDigit(cc);

// #endregion

// #region keyword tables

// after these keywords a `/` begins a regular expression, never division
const expressionKeywords = new Set([
	'await',
	'case',
	'default',
	'delete',
	'do',
	'else',
	'extends',
	'in',
	'instanceof',
	'new',
	'return',
	'throw',
	'typeof',
	'void',
	'yield',
]);

// a `)` closing one of these keyword parens is followed by a regex, not division
const controlKeywords = new Set(['for', 'if', 'switch', 'while', 'with']);

// keywords whose following `{` opens a declaration block (not an object literal)
const blockKeywords = new Set(['class', 'interface', 'module', 'namespace']);

// #endregion

interface Open {
	before: Token | undefined;
	kind: 'brace' | 'bracket' | 'paren' | 'templateBrace';
	opener: Token;
}

class Lexer {
	// stack of unresolved switch labels, innermost last; each records the open-stack
	// depth where its `case`/`default` began and how many ternary `?` are still
	// awaiting their `:`, so the label `:` (the one at that depth with no pending
	// ternary) can be told apart from ternary and nested colons in the test
	private caseLabels: { depth: number; ternary: number }[] = [];
	private nextBraceIsBlock = false;
	private open: Open[] = [];
	private pos = 0;
	// significant (non-whitespace, non-comment) tokens, for lookback
	private sig: Token[] = [];
	private readonly source: string;
	private tokens: Token[] = [];

	constructor(source: string) {
		this.source = source;
	}

	run(): Token[] {
		const src = this.source;
		while (this.pos < src.length) {
			this.scanToken();
		}
		return this.tokens;
	}

	private text(t: Token): string {
		return this.source.slice(t.start, t.end);
	}

	private push(kind: TokenKind, start: number, newlines = 0): Token {
		const token: Token = { end: this.pos, kind, newlines, start };
		this.tokens.push(token);
		if (kind !== 'whitespace' && kind !== 'lineComment' && kind !== 'blockComment') {
			this.sig.push(token);
		}
		return token;
	}

	private get lastSig(): Token | undefined {
		return this.sig[this.sig.length - 1];
	}

	private prevSig(t: Token): Token | undefined {
		// callers pass the most recent significant token, so search from the end
		const i = this.sig.lastIndexOf(t);
		return i > 0 ? this.sig[i - 1] : undefined;
	}

	private scanToken(): void {
		const src = this.source;
		const start = this.pos;
		const cc = src.charCodeAt(this.pos);

		// a `#!` hashbang is a line comment only as the very first bytes of the source
		if (start === 0 && cc === Char.hash && src.charCodeAt(1) === Char.bang) {
			return this.scanLineComment(start);
		}
		if (isWhiteSpace(cc) || isLineTerminator(cc)) {
			return this.scanWhitespace(start);
		}
		switch (cc) {
			case Char.singleQuote:
			case Char.doubleQuote: {
				return this.scanString(start, cc);
			}
			case Char.backtick: {
				return this.scanTemplate(start, false);
			}
			case Char.slash: {
				return this.scanSlash(start);
			}
			default:
		}
		if (isDigit(cc) || (cc === Char.dot && isDigit(src.charCodeAt(this.pos + 1)))) {
			return this.scanNumber(start);
		}
		if (
			isIdStart(cc) ||
			cc === Char.hash ||
			(cc === Char.backslash && src.charCodeAt(this.pos + 1) === Char.u)
		) {
			return this.scanIdentifier(start);
		}
		this.scanPunctuator(start);
	}

	private scanWhitespace(start: number): void {
		const src = this.source;
		let newlines = 0;
		while (this.pos < src.length) {
			const cc = src.charCodeAt(this.pos);
			if (isLineTerminator(cc)) {
				// treat CRLF as a single line terminator
				if (!(cc === Char.lf && src.charCodeAt(this.pos - 1) === Char.cr)) {
					newlines++;
				}
			} else if (!isWhiteSpace(cc)) {
				break;
			}
			this.pos++;
		}
		this.push('whitespace', start, newlines);
	}

	private scanString(start: number, quote: number): void {
		const src = this.source;
		this.pos++;
		while (this.pos < src.length) {
			const cc = src.charCodeAt(this.pos);
			if (cc === Char.backslash) {
				// a line continuation may be a CRLF pair, which is one line
				// terminator sequence and must be consumed as a whole
				const escaped = src.charCodeAt(this.pos + 1);
				this.pos += escaped === Char.cr && src.charCodeAt(this.pos + 2) === Char.lf ? 3 : 2;
				continue;
			}
			this.pos++;
			// U+2028/U+2029 are valid unescaped in a string body; only a raw CR or
			// LF (never legal unescaped) terminates the literal
			if (cc === quote || cc === Char.cr || cc === Char.lf) {
				break;
			}
		}
		this.push('string', start);
	}

	// scans from a backtick (continuation = false) or from a `}` that closes an
	// interpolation (continuation = true), emitting one template piece and, when
	// it ends at `${`, opening a templateBrace on the stack
	private scanTemplate(start: number, continuation: boolean): void {
		const src = this.source;
		this.pos++; // consume the backtick or `}`
		let head = false;
		while (this.pos < src.length) {
			const cc = src.charCodeAt(this.pos);
			if (cc === Char.backslash) {
				this.pos += 2;
				continue;
			}
			if (cc === Char.backtick) {
				this.pos++;
				break;
			}
			if (cc === Char.dollar && src.charCodeAt(this.pos + 1) === Char.openBrace) {
				this.pos += 2;
				head = true;
				break;
			}
			this.pos++;
		}
		let kind: TokenKind;
		if (continuation) {
			kind = head ? 'templateMiddle' : 'templateTail';
		} else {
			kind = head ? 'templateHead' : 'template';
		}
		const token = this.push(kind, start);
		if (head) {
			this.open.push({ before: this.prevSig(token), kind: 'templateBrace', opener: token });
		}
	}

	private scanLineComment(start: number): void {
		const src = this.source;
		this.pos += 2;
		while (this.pos < src.length && !isLineTerminator(src.charCodeAt(this.pos))) {
			this.pos++;
		}
		this.push('lineComment', start);
	}

	private scanBlockComment(start: number): void {
		const src = this.source;
		this.pos += 2;
		while (this.pos < src.length) {
			if (src.charCodeAt(this.pos) === Char.star && src.charCodeAt(this.pos + 1) === Char.slash) {
				this.pos += 2;
				break;
			}
			this.pos++;
		}
		this.push('blockComment', start);
	}

	private scanSlash(start: number): void {
		const src = this.source;
		const next = src.charCodeAt(this.pos + 1);
		if (next === Char.slash) {
			return this.scanLineComment(start);
		}
		if (next === Char.star) {
			return this.scanBlockComment(start);
		}
		if (this.slashStartsRegex() && this.tryScanRegex(start)) {
			return;
		}
		// division or division-assign
		this.pos += next === 61 ? 2 : 1;
		this.push('punctuator', start);
	}

	// tries to scan a regular expression; a regex literal cannot span lines, so a
	// `/` with no closing `/` before a line terminator is not a regex but a
	// division (returning false leaves the cursor untouched for the caller)
	private tryScanRegex(start: number): boolean {
		const src = this.source;
		let pos = this.pos + 1; // past the opening `/`
		let inClass = false;
		while (pos < src.length) {
			const cc = src.charCodeAt(pos);
			if (isLineTerminator(cc)) {
				return false;
			}
			if (cc === Char.backslash) {
				if (isLineTerminator(src.charCodeAt(pos + 1))) {
					return false;
				}
				pos += 2;
				continue;
			}
			pos++;
			if (cc === 91) {
				inClass = true;
			} else if (cc === 93) {
				inClass = false;
			} else if (cc === Char.slash && !inClass) {
				// flags
				while (pos < src.length && isIdContinue(src.charCodeAt(pos))) {
					pos++;
				}
				this.pos = pos;
				this.push('regex', start);
				return true;
			}
		}
		return false;
	}

	private scanNumber(start: number): void {
		const src = this.source;
		// consume any run of characters that can appear in a numeric literal;
		// the input is assumed valid, so a permissive scan suffices
		this.pos++;
		while (this.pos < src.length) {
			const cc = src.charCodeAt(this.pos);
			if (isIdContinue(cc) || cc === Char.dot) {
				this.pos++;
			} else if ((cc === 43 || cc === 45) && this.isExponentMark(src.charCodeAt(this.pos - 1))) {
				// signed exponent, e.g. 1e-9
				this.pos++;
			} else {
				break;
			}
		}
		this.push('number', start);
	}

	private isExponentMark(cc: number): boolean {
		return cc === 101 || cc === 69; // e E
	}

	private scanIdentifier(start: number): void {
		const src = this.source;
		if (src.charCodeAt(this.pos) === Char.hash) {
			this.pos++; // private-name prefix `#`
		}
		while (this.pos < src.length) {
			const cc = src.charCodeAt(this.pos);
			if (cc === Char.backslash && src.charCodeAt(this.pos + 1) === Char.u) {
				// unicode escape in an identifier: `\uXXXX`, whose hex digits the
				// loop then consumes as id-continues, or the bracketed `\u{…}`
				this.pos += 2;
				if (src.charCodeAt(this.pos) === Char.openBrace) {
					while (this.pos < src.length && src.charCodeAt(this.pos) !== Char.closeBrace) {
						this.pos++;
					}
					this.pos++; // closing `}`
				}
			} else if (isIdContinue(cc)) {
				this.pos++;
			} else {
				break;
			}
		}
		const token = this.push('identifier', start);
		// c/d/i/m/n lead the only keywords that steer brace classification: the
		// declaration keywords whose `{` opens a block, and switch `case`/`default`
		// labels whose `:` makes the following `{` a block. skip the slice otherwise
		const c0 = src.charCodeAt(start);
		if (c0 === 99 || c0 === 100 || c0 === 105 || c0 === 109 || c0 === 110) {
			const w = this.text(token);
			if (blockKeywords.has(w)) {
				this.nextBraceIsBlock = true;
			} else if ((w === 'case' || w === 'default') && this.inSwitchBody()) {
				this.caseLabels.push({ depth: this.open.length, ternary: 0 });
			}
		}
	}

	// whether the innermost open delimiter is a block brace, the only place a bare
	// `case`/`default` is a switch label rather than an object key (`{ case: 1 }`)
	// or an `export default` value
	private inSwitchBody(): boolean {
		const top = this.open[this.open.length - 1];
		return top !== undefined && top.kind === 'brace' && top.opener.block === true;
	}

	private scanPunctuator(start: number): void {
		const src = this.source;
		const cc = src.charCodeAt(this.pos);
		switch (cc) {
			case 40: {
				// (
				this.pos++;
				this.open.push({ before: this.lastSig, kind: 'paren', opener: this.push('punctuator', start) });
				return;
			}
			case 91: {
				// [
				this.pos++;
				this.open.push({ before: this.lastSig, kind: 'bracket', opener: this.push('punctuator', start) });
				return;
			}
			case Char.openBrace: {
				return this.openBrace(start);
			}
			case 41: {
				// )
				return this.closeParen(start);
			}
			case 93: {
				// ]
				this.pos++;
				this.push('punctuator', start);
				this.open.pop();
				return;
			}
			case 125: {
				// }
				return this.closeBrace(start);
			}
			default:
		}
		// `?.` is one token only when not followed by a digit
		if (cc === 63 && src.charCodeAt(this.pos + 1) === Char.dot && !isDigit(src.charCodeAt(this.pos + 2))) {
			this.pos += 2;
			this.push('punctuator', start);
			return;
		}
		const len = this.punctuatorLength(start);
		this.pos += len;
		const token = this.push('punctuator', start);
		// resolve a pending switch label: a bare `?` defers its label colon, the
		// matching `:` consumes it, and the next unmatched `:` at the label's depth
		// is the label colon itself
		if (this.caseLabels.length > 0 && (cc === Char.colon || (cc === Char.question && len === 1))) {
			this.trackCaseLabel(token, cc);
		}
	}

	private trackCaseLabel(colonOrQuestion: Token, cc: number): void {
		const top = this.caseLabels[this.caseLabels.length - 1];
		if (top.depth !== this.open.length) {
			return;
		}
		if (cc === Char.question) {
			top.ternary++;
		} else if (top.ternary > 0) {
			top.ternary--;
		} else {
			colonOrQuestion.caseColon = true;
			this.caseLabels.pop();
		}
	}

	private openBrace(start: number): void {
		const before = this.lastSig;
		this.pos++;
		// a `{` with nothing before it opens the program's first statement, which
		// is a block — an expression statement can never begin with `{`
		const block =
			this.nextBraceIsBlock || before === undefined || isExpressionTerminator(before, this.source);
		this.nextBraceIsBlock = false;
		const token = this.push('punctuator', start);
		token.block = block;
		this.open.push({ before, kind: 'brace', opener: token });
	}

	private closeParen(start: number): void {
		this.pos++;
		const token = this.push('punctuator', start);
		const entry = this.open.pop();
		if (entry) {
			token.keywordParen =
				entry.before !== undefined &&
				entry.before.kind === 'identifier' &&
				controlKeywords.has(this.text(entry.before));
		}
	}

	private closeBrace(start: number): void {
		const top = this.open[this.open.length - 1];
		if (top && top.kind === 'templateBrace') {
			this.open.pop();
			return this.scanTemplate(start, true);
		}
		this.pos++;
		const token = this.push('punctuator', start);
		const entry = this.open.pop();
		if (entry) {
			token.block = entry.opener.block;
		}
	}

	// the byte length of the punctuator at `start`, found by dispatching on its
	// first code unit and probing the next few — the operator set is small and
	// fixed, so direct comparisons beat scanning a table of candidate strings.
	// `/`-led operators never reach here (scanSlash handles them)
	private punctuatorLength(start: number): number {
		const src = this.source;
		const c1 = src.charCodeAt(start + 1);
		switch (src.charCodeAt(start)) {
			case 33: {
				// !  →  != !==
				return c1 === 61 ? (src.charCodeAt(start + 2) === 61 ? 3 : 2) : 1;
			}
			case 37: // %  →  %=
			case 94: {
				// ^  →  ^=
				return c1 === 61 ? 2 : 1;
			}
			case 38: // &  →  & && &= &&=
			case 124: {
				// | →  | || |= ||=
				if (c1 === src.charCodeAt(start)) {
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 61 ? 2 : 1;
			}
			case 42: {
				// *  →  * ** *= **=
				if (c1 === 42) {
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 61 ? 2 : 1;
			}
			case 43: {
				// +  →  + ++ +=
				return c1 === 43 || c1 === 61 ? 2 : 1;
			}
			case 45: {
				// -  →  - -- -=
				return c1 === 45 || c1 === 61 ? 2 : 1;
			}
			case 46: {
				// .  →  . ...
				return c1 === 46 && src.charCodeAt(start + 2) === 46 ? 3 : 1;
			}
			case 60: {
				// <  →  < << <= <<=
				if (c1 === 60) {
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 61 ? 2 : 1;
			}
			case 61: {
				// =  →  = == => ===
				if (c1 === 61) {
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 62 ? 2 : 1;
			}
			case 62: {
				// >  →  > >> >= >>> >>= >>>=
				if (c1 === 62) {
					if (src.charCodeAt(start + 2) === 62) {
						return src.charCodeAt(start + 3) === 61 ? 4 : 3;
					}
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 61 ? 2 : 1;
			}
			case 63: {
				// ?  →  ? ?? ??= ?. (the early `?.` path is skipped before a digit, so `?.` can reach here)
				if (c1 === 63) {
					return src.charCodeAt(start + 2) === 61 ? 3 : 2;
				}
				return c1 === 46 ? 2 : 1;
			}
			default: {
				return 1;
			}
		}
	}

	// the regex/division decision, reconstructing the parser's choice from the
	// preceding significant token plus the open-token stack (after es-module-lexer)
	private slashStartsRegex(): boolean {
		const t = this.lastSig;
		if (!t) {
			return true; // start of input
		}
		if (t.kind === 'identifier') {
			const w = this.text(t);
			if (expressionKeywords.has(w)) {
				return true;
			}
			// `break x` / `continue x` then `/` starts a new statement → regex
			const p = this.prevSig(t);
			if (p && (this.text(p) === 'break' || this.text(p) === 'continue')) {
				return true;
			}
			// `for (x of /re/)`
			if (w === 'of' && this.isForOfHead()) {
				return true;
			}
			return false; // plain identifier / this / super / value keyword → division
		}
		return !this.isValueEnd(t);
	}

	private isForOfHead(): boolean {
		const top = this.open[this.open.length - 1];
		return (
			top !== undefined &&
			top.kind === 'paren' &&
			top.before !== undefined &&
			top.before.kind === 'identifier' &&
			this.text(top.before) === 'for'
		);
	}

	// true when an expression value ends at `t`, so a following `/` is division
	// and a following `!` is a postfix non-null assertion
	private isValueEnd(t: Token): boolean {
		switch (t.kind) {
			case 'number':
			case 'regex':
			case 'string':
			case 'template':
			case 'templateTail': {
				return true;
			}
			case 'identifier': {
				return !expressionKeywords.has(this.text(t));
			}
			case 'punctuator': {
				const txt = this.text(t);
				switch (txt) {
					case '!': {
						// TS postfix non-null assertion chains a value end
						return this.isPrecededByValue(t);
					}
					case '++':
					case '--': {
						return true;
					}
					case ')': {
						return t.keywordParen !== true;
					}
					case ']': {
						return true;
					}
					case '}': {
						return t.block !== true;
					}
					default: {
						return false;
					}
				}
			}
			default: {
				return false;
			}
		}
	}

	private isPrecededByValue(t: Token): boolean {
		const p = this.prevSig(t);
		return p !== undefined && this.isValueEnd(p);
	}
}

// the `{` opener of a block is preceded by one of these "expression terminator"
// tokens; otherwise the `{` opens an object literal
const isExpressionTerminator = (before: Token | undefined, source: string): boolean => {
	if (!before) {
		return false;
	}
	// a switch label colon opens the case body, which is a block
	if (before.caseColon === true) {
		return true;
	}
	if (before.kind === 'punctuator') {
		const txt = source.slice(before.start, before.end);
		return txt === ')' || txt === ';' || txt === '=>' || txt === '{' || txt === '}';
	}
	if (before.kind === 'identifier') {
		const txt = source.slice(before.start, before.end);
		return txt === 'catch' || txt === 'do' || txt === 'else' || txt === 'finally' || txt === 'try';
	}
	return false;
};

/**
 * tokenizes JavaScript/TypeScript source into a lossless stream where every byte belongs to exactly one
 * {@link Token}.
 *
 * input is assumed valid and not reliant on automatic semicolon insertion; no JSX/TSX. the scan is
 * single-pass and never allocates beyond the token array.
 *
 * @param source the source text to tokenize
 * @returns the token stream, in source order, covering the whole input
 */
export const tokenize = (source: string): Token[] => new Lexer(source).run();
