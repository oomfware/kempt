import type { Doc } from './doc.ts';
import { breakParent, hardline, line } from './doc.ts';
import { closerFor, type Token, type TokenKind } from './token.ts';

// reserved words that take a space before whatever follows them (`return x`,
// `new Foo`, `else if`); excludes the value keywords below
const keywords = new Set([
	'abstract',
	'as',
	'async',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'declare',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'finally',
	'for',
	'from',
	'function',
	'get',
	'if',
	'implements',
	'import',
	'in',
	'infer',
	'instanceof',
	'interface',
	'is',
	'keyof',
	'let',
	'namespace',
	'new',
	'of',
	'out',
	'override',
	'private',
	'protected',
	'public',
	'readonly',
	'return',
	'satisfies',
	'set',
	'static',
	'switch',
	'throw',
	'try',
	'type',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
]);

// binary and assignment operators that sit on a space either side
const binaryOperators = new Set([
	'!=',
	'!==',
	'%',
	'%=',
	'&',
	'&&',
	'&&=',
	'&=',
	'*=',
	'**',
	'**=',
	'/',
	'/=',
	'<<',
	'<<=',
	'<=',
	'=',
	'==',
	'===',
	'=>',
	'>=',
	'>>',
	'>>=',
	'>>>',
	'>>>=',
	'?',
	'??',
	'??=',
	'^',
	'^=',
	'|',
	'|=',
	'||',
	'||=',
]);

/**
 * how a token binds to its neighbours for spacing. `tl` (tight-left) suppresses a space before the token;
 * `tr` (tight-right) suppresses a space after it; `value` marks that the token ends an expression value (so a
 * following `(` is a call, `++`/`!` are postfix, and an operator is binary).
 */
interface Role {
	tl: boolean;
	tr: boolean;
	value: boolean;
}

const role = (tl: boolean, tr: boolean, value = false): Role => ({ tl, tr, value });

const roles = {
	binary: role(false, false),
	blockClose: role(false, false),
	break: role(false, true),
	call: role(true, false, true),
	close: role(false, false, true),
	colonObject: role(true, false),
	colonTernary: role(false, false),
	decorator: role(false, true),
	keyword: role(false, false),
	member: role(true, true),
	none: role(true, true),
	open: role(false, false),
	prefix: role(false, true),
	postfix: role(true, false, true),
	semicolon: role(true, false),
	star: role(true, false),
	templateHead: role(false, true),
	templateMiddle: role(true, true),
	templateTail: role(true, false, true),
	value: role(false, false, true),
} as const;

const classify = (text: string, kind: TokenKind, prevValue: boolean): Role => {
	switch (kind) {
		case 'number':
		case 'regex':
		case 'string':
		case 'template': {
			return roles.value;
		}
		case 'templateHead': {
			return roles.templateHead;
		}
		case 'templateMiddle': {
			return roles.templateMiddle;
		}
		case 'templateTail': {
			return roles.templateTail;
		}
		case 'identifier': {
			// value keywords (`this`, `true`, …) are not in `keywords`, so they fall
			// through as values without a separate check
			return keywords.has(text) ? roles.keyword : roles.value;
		}
		default:
	}
	// punctuator
	switch (text) {
		case '.':
		case '?.': {
			return roles.member;
		}
		case ',':
		case ';': {
			return roles.semicolon;
		}
		case '@': {
			return roles.decorator;
		}
		case '...': {
			return roles.prefix;
		}
		case '~': {
			return roles.prefix;
		}
		case '!':
		case '++':
		case '--': {
			return prevValue ? roles.postfix : roles.prefix;
		}
		case '+':
		case '-': {
			return prevValue ? roles.binary : roles.prefix;
		}
		case '*': {
			return prevValue ? roles.binary : roles.star;
		}
		default:
	}
	if (binaryOperators.has(text)) {
		return roles.binary;
	}
	return roles.value;
};

/**
 * accumulates the docs of one flow (a statement or a bracket interior), inserting canonical spacing between
 * tokens. the only spacing taken from the input is around `<`/`>`, which are ambiguous between generics and
 * comparison and so are left as the author wrote them.
 */
export class Spacer {
	/**
	 * whether this flow contains a forced break — a line comment's {@link hardline} or a trailing comment's
	 * {@link breakParent}, directly or folded up from a nested bracket. lets the builder set a wrapping group's
	 * `shouldBreak` as it builds, so the printer needs no separate break-propagation pass.
	 */
	forced = false;
	readonly parts: Doc[] = [];
	/**
	 * whether this flow emitted a real `,`/`;` separator, so its bracket interior is a list with a meaningful
	 * breakpoint. a single-item interior (`includes(locale)`) has none and so is never broken for width — only
	 * lists and forced breaks expand.
	 */
	separated = false;
	private prev: Role = roles.none;
	private prevNumber = false;
	private prevText = '';
	private ternary = 0;

	private emit(r: Role, doc: Doc, authorSpace: boolean): void {
		if (this.parts.length > 0) {
			const angle = anglePreserve(this.prevText) || anglePreserve(typeof doc === 'string' ? doc : '');
			const space = angle ? authorSpace : !this.prev.tr && !r.tl;
			if (space) {
				this.parts.push(' ');
			}
		}
		this.parts.push(doc);
		this.prev = r;
		this.prevNumber = false;
	}

	/** adds a plain token, choosing the space before it from its role. */
	token(text: string, kind: TokenKind, authorSpace: boolean): void {
		if ((text === '.' || text === '?.') && kind === 'punctuator' && this.prevNumber) {
			// member access on a numeric literal keeps a space, or `1 .x` would
			// re-lex as the number `1.` followed by `x`
			if (this.parts.length > 0) {
				this.parts.push(' ');
			}
			this.parts.push(text);
			this.prev = roles.member;
			this.prevText = text;
			return;
		}
		let r: Role;
		if (text === ':' && kind === 'punctuator') {
			r = this.ternary > 0 ? roles.colonTernary : roles.colonObject;
			if (this.ternary > 0) {
				this.ternary--;
			}
		} else if (kind === 'identifier' && (this.prevText === '.' || this.prevText === '?.')) {
			// an identifier after a member access is a property name, never a
			// keyword, so `obj.catch(` is a call, not `catch (`
			r = roles.value;
		} else if (
			text === '*' &&
			kind === 'punctuator' &&
			(this.prevText === 'export' || this.prevText === 'import' || this.prevText === 'type')
		) {
			// the namespace star in `import * as` / `export * from` (and their `type`
			// variants) takes a space either side, unlike a generator star (`function*`)
			r = roles.binary;
		} else if (
			text === '*' &&
			kind === 'punctuator' &&
			!this.prev.value &&
			this.prevText !== 'function' &&
			this.prevText !== 'yield'
		) {
			// a generator method's leading star prefixes the member, so it hugs the
			// name (`*gen`, `*[Symbol.iterator]`) while still taking a space after a
			// preceding modifier (`async *gen`). the `function*`/`yield*` stars keep
			// their trailing space and fall through to `classify`
			r = roles.prefix;
		} else {
			r = classify(text, kind, this.prev.value);
			if (text === '?' && kind === 'punctuator') {
				this.ternary++;
			}
		}
		this.emit(r, text, authorSpace);
		this.prevText = text;
		this.prevNumber = kind === 'number';
	}

	/**
	 * adds a pre-built bracketed construct, treating it as a call/index after a value. `childForced` is whether
	 * the construct contains a forced break, which folds into this flow so an enclosing group breaks too.
	 */
	bracket(doc: Doc, opener: Token, openText: string, authorSpace: boolean, childForced: boolean): void {
		const call = (openText === '(' || openText === '[') && this.prev.value;
		this.emit(call ? roles.call : roles.open, doc, authorSpace);
		const block = openText === '{' && opener.block === true;
		this.prev = block ? roles.blockClose : roles.close;
		this.prevText = closerFor[openText];
		this.forced ||= childForced;
	}

	/** adds a token that binds tightly on both sides, like the optional marker in `meta?:`. */
	tight(text: string): void {
		this.emit(roles.member, text, false);
		this.prevText = text;
	}

	/** adds a `,` or `;` separator, an optional trailing comment, then a soft break. */
	separator(text: string, trailing?: string): void {
		// an empty item (a separator straight after another, as in `for (;;)`)
		// leaves a dangling break; drop it so the separators sit flush
		if (this.parts[this.parts.length - 1] === line) {
			this.parts.pop();
		}
		this.parts.push(text);
		if (trailing !== undefined) {
			// a line comment ends the line, so the interior must break, not flow flat
			this.parts.push(' ', trailing, breakParent);
			this.forced = true;
		}
		this.parts.push(line);
		this.prev = roles.break;
		this.prevText = text;
		this.prevNumber = false;
		this.separated = true;
	}

	/** adds a line comment that stays on the current line; the flow's break follows it. */
	trailingComment(text: string): void {
		if (this.parts.length > 0) {
			this.parts.push(' ');
		}
		this.parts.push(text);
		this.prev = roles.break;
		this.prevText = '';
		this.prevNumber = false;
	}

	/**
	 * adds a comment.
	 *
	 * a line comment, and a block comment that sat on its own line (`breaks.onOwnLine`), forces the enclosing
	 * group to break so the next token never shares the comment's line — a line comment's `//` runs to the end
	 * of the line, and an own-line comment is kept where the author put it. the break's newline is suppressed
	 * when the comment sits right before the group's closer (`breaks.beforeCloser`), whose own edge already
	 * supplies it; a second newline would strand a blank line before the closer.
	 */
	comment(
		text: string,
		kind: TokenKind,
		authorSpace: boolean,
		breaks: { beforeCloser: boolean; onOwnLine: boolean },
	): void {
		// a multi-line JSDoc block (`/**` opener, every interior line a `*`
		// continuation) is the one comment kempt re-lays out: it sits on its own
		// lines, forcing the enclosing group to break, and its body is re-indented to
		// the comment's column. trimming each interior line before re-emitting is
		// what keeps that stable across passes, since a prepended indent would
		// otherwise compound. every other comment keeps its bytes verbatim
		if (kind === 'blockComment' && text.startsWith('/**')) {
			const lines = text.split(/\r\n|\r|\n/);
			if (lines.length > 1 && indentableBlockComment(lines)) {
				this.emit(roles.value, lines[0].trimEnd(), authorSpace);
				for (let k = 1; k < lines.length; k++) {
					this.parts.push(hardline, ' ' + lines[k].trimStart());
				}
				this.prev = roles.break;
				this.prevText = '';
				this.forced = true;
				// the reflow always lands the `*/` on its own line, so anything after it
				// must drop below; the closer's edge handles that when nothing follows
				if (!breaks.beforeCloser) {
					this.parts.push(hardline);
				}
				return;
			}
		}
		this.emit(roles.value, text, authorSpace);
		this.prevText = '';
		if (kind === 'lineComment' || breaks.onOwnLine) {
			if (!breaks.beforeCloser) {
				this.parts.push(hardline);
			}
			this.prev = roles.break;
			this.forced = true;
		}
	}
}

// a block comment whose every interior line (after the opener) is a `*`
// continuation — the conventional JSDoc shape. only these are re-indented; any
// other body keeps its deliberate interior layout verbatim
const indentableBlockComment = (lines: string[]): boolean => {
	for (let k = 1; k < lines.length; k++) {
		if (!lines[k].trimStart().startsWith('*')) {
			return false;
		}
	}
	return true;
};

// operators built from `<`/`>` are ambiguous between generics and
// comparison/shift, and `>`-led ones can even be mis-lexed across a generic
// close (`Foo<T>=x` scans `>=`); spacing around them is left as written so the
// formatter can never turn a generic into a different parse
const angleOperators = new Set(['<', '<<', '<<=', '<=', '>', '>=', '>>', '>>=', '>>>', '>>>=']);

const anglePreserve = (text: string): boolean => angleOperators.has(text);
