import type { Doc } from './doc.ts';
import { group, indent, indentIfBreak, line, softline } from './doc.ts';
import { Spacer } from './spacing.ts';
import type { Token } from './token.ts';

// closing punctuator for each opener
const closerFor: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

// keywords that continue the statement after a preceding block, so `} else {`
// and `} catch {` stay on one line rather than splitting into two statements
const continuationKeywords = new Set(['catch', 'else', 'finally', 'while']);

// statement leads that warrant a blank line before them at the top level
const declarationKeywords = new Set(['abstract', 'class', 'enum', 'function', 'interface', 'namespace']);

interface Statement {
	doc: Doc;
	/** whether the statement contains a forced break, so an enclosing block's break can propagate outward. */
	forced: boolean;
	/** the leading keyword used for blank-line decisions (`import`, `function`, …). */
	lead: string;
}

// an in-progress container on the builder's explicit work stack. a `statements`
// frame is the program (close `null`) or a block body; an `items` frame is the
// comma-separated interior of a paren, bracket, or object brace. an explicit
// stack replaces recursive descent so deeply nested input cannot overflow.
type Frame = ItemsFrame | StmtFrame;

interface StmtFrame {
	close: string | null;
	leads: Token[];
	/** the `{` that opened this block, or undefined for the root program frame. */
	opener: Token | undefined;
	/** author space before the opener, applied when the finished block attaches. */
	openerSpace: boolean;
	out: Statement[];
	space: boolean;
	spacer: Spacer;
	type: 'statements';
}

interface ItemsFrame {
	close: string;
	opener: Token;
	openText: string;
	openerSpace: boolean;
	space: boolean;
	spacer: Spacer;
	type: 'items';
}

class Builder {
	private i = 0;
	private nextId = 0;
	private readonly source: string;
	private readonly tokens: Token[];

	constructor(tokens: Token[], source: string) {
		this.tokens = tokens;
		this.source = source;
	}

	build(): Doc {
		const root: StmtFrame = {
			close: null,
			leads: [],
			opener: undefined,
			openerSpace: false,
			out: [],
			space: false,
			spacer: new Spacer(),
			type: 'statements',
		};
		const stack: Frame[] = [root];
		let result: Doc = '';

		// each token is dispatched to the frame on top of the stack; openers push a
		// child frame, closers (and end of input) finalize the top frame and attach
		// its document to the parent
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			if (this.i >= this.tokens.length) {
				const finished = stack.pop()!;
				const doc = this.finalize(finished);
				if (stack.length === 0) {
					result = doc;
				} else {
					this.attach(finished, doc, stack[stack.length - 1]);
				}
				continue;
			}
			if (frame.type === 'statements') {
				this.stepStatements(frame, stack);
			} else {
				this.stepItems(frame, stack);
			}
		}
		return result;
	}

	// dispatches the token at the cursor within a `statements` frame, mirroring a
	// single iteration of the original recursive `statements` loop
	private stepStatements(frame: StmtFrame, stack: Frame[]): void {
		const t = this.tokens[this.i];
		if (t.kind === 'whitespace') {
			frame.space = true;
			this.i++;
			return;
		}
		if (t.kind === 'lineComment' || t.kind === 'blockComment') {
			frame.spacer.comment(this.text(t), t.kind, frame.space);
			frame.space = false;
			this.i++;
			return;
		}
		const txt = this.text(t);
		if (frame.close !== null && t.kind === 'punctuator' && txt === frame.close) {
			this.i++;
			this.closeTop(stack);
			return;
		}
		if (frame.leads.length < 3) {
			frame.leads.push(t);
		}
		if (t.kind === 'punctuator' && (txt === '(' || txt === '[' || txt === '{')) {
			this.openChild(t, txt, frame.space, stack);
			return;
		}
		if (this.optionalMarker(t)) {
			frame.spacer.tight('?');
		} else {
			frame.spacer.token(txt, t.kind, frame.space);
		}
		frame.space = false;
		this.i++;
		if (t.kind === 'punctuator' && txt === ';') {
			const trailing = this.trailingComment();
			if (trailing !== undefined) {
				frame.spacer.trailingComment(trailing);
			}
			this.flushStatement(frame);
		}
	}

	// dispatches the token at the cursor within an `items` frame, mirroring a
	// single iteration of the original recursive `items` loop
	private stepItems(frame: ItemsFrame, stack: Frame[]): void {
		const t = this.tokens[this.i];
		if (t.kind === 'whitespace') {
			frame.space = true;
			this.i++;
			return;
		}
		if (t.kind === 'lineComment' || t.kind === 'blockComment') {
			frame.spacer.comment(this.text(t), t.kind, frame.space);
			frame.space = false;
			this.i++;
			return;
		}
		const txt = this.text(t);
		if (t.kind === 'punctuator' && txt === frame.close) {
			this.i++;
			this.closeTop(stack);
			return;
		}
		// a comma or a semicolon (object-type members, `for (;;)` heads) separates
		// items and is the only place this interior may break
		if (t.kind === 'punctuator' && (txt === ',' || txt === ';')) {
			this.i++;
			frame.spacer.separator(txt, this.trailingComment());
			frame.space = false;
			return;
		}
		if (t.kind === 'punctuator' && (txt === '(' || txt === '[' || txt === '{')) {
			this.openChild(t, txt, frame.space, stack);
			return;
		}
		if (this.optionalMarker(t)) {
			frame.spacer.tight('?');
		} else {
			frame.spacer.token(txt, t.kind, frame.space);
		}
		frame.space = false;
		this.i++;
	}

	// pushes a child frame for a bracketed construct; the cursor is on the opener,
	// which this consumes. a `{` that opens a block becomes a `statements` frame,
	// every other opener an `items` frame
	private openChild(opener: Token, openText: string, space: boolean, stack: Frame[]): void {
		this.i++; // consume the opener
		if (openText === '{' && opener.block === true) {
			stack.push({
				close: '}',
				leads: [],
				opener,
				openerSpace: space,
				out: [],
				space: false,
				spacer: new Spacer(),
				type: 'statements',
			});
			return;
		}
		stack.push({
			close: closerFor[openText],
			opener,
			openText,
			openerSpace: space,
			space: false,
			spacer: new Spacer(),
			type: 'items',
		});
	}

	// finalizes the top frame and attaches its document to the new top
	private closeTop(stack: Frame[]): void {
		const finished = stack.pop()!;
		const doc = this.finalize(finished);
		this.attach(finished, doc, stack[stack.length - 1]);
	}

	// builds the document for a completed frame
	private finalize(frame: Frame): Doc {
		if (frame.type === 'statements') {
			this.flushStatement(frame);
			if (frame.opener === undefined) {
				return this.joinStatements(frame.out, true);
			}
			if (frame.out.length === 0) {
				return '{}';
			}
			return group(['{', indent([line, this.joinStatements(frame.out, false)]), line, '}'], {
				shouldBreak: true,
			});
		}
		const parts = frame.spacer.parts;
		// a trailing separator leaves a dangling break before the closer; drop it
		if (parts[parts.length - 1] === line) {
			parts.pop();
		}
		if (parts.length === 0) {
			return frame.openText + frame.close;
		}
		// object braces sit on spaces (`{ a }`); parens and brackets hug (`(a)`).
		// indentIfBreak keyed to this group lets a flat call that hugs a broken
		// block argument keep the block at a single indent level. a forced break in
		// the interior (a comment) breaks the group, the same conclusion the printer's
		// break propagation would reach — set here so it needs no separate pass
		const edge = frame.openText === '{' ? line : softline;
		const id = this.nextId++;
		return group([frame.openText, indentIfBreak([edge, parts], id), edge, frame.close], {
			id,
			selfScoped: true,
			shouldBreak: frame.spacer.forced,
			widthBreakable: frame.spacer.separated,
		});
	}

	// whether a finished frame contains a forced break, to fold into its parent. a
	// block reports only its statements' forced breaks, never its own always-broken
	// layout, so a call hugging a plain block stays flat
	private frameForced(frame: Frame): boolean {
		if (frame.type === 'items') {
			return frame.spacer.forced;
		}
		for (const s of frame.out) {
			if (s.forced) {
				return true;
			}
		}
		return false;
	}

	// a method or accessor body — a non-empty block sitting directly inside an
	// object literal — forces that object to break, so a sibling member never shares
	// the opening line with a body that always expands. a call argument keeps hugging
	// its block (its parent is a paren or bracket, not an object brace), so this is
	// scoped to the object case the hug rule in `frameForced` would otherwise leave flat
	private bodyBreaksObject(child: Frame, parent: Frame): boolean {
		return (
			child.type === 'statements' &&
			child.opener !== undefined &&
			child.out.length > 0 &&
			parent.type === 'items' &&
			parent.openText === '{'
		);
	}

	// attaches a finished child's document into its parent's spacer, then applies
	// the statement-ending flush a block triggers inside a `statements` parent
	private attach(finished: Frame, doc: Doc, parent: Frame): void {
		const openText = finished.type === 'statements' ? '{' : finished.openText;
		const forced = this.frameForced(finished) || this.bodyBreaksObject(finished, parent);
		parent.spacer.bracket(doc, finished.opener!, openText, finished.openerSpace, forced);
		parent.space = false;
		if (parent.type !== 'statements' || finished.type !== 'statements') {
			return;
		}
		// a block usually ends the statement, but not when the block is part of an
		// expression that an explicit `;` will terminate (`const f = () => {};`) or
		// a continuation follows (`} else {`)
		const next = this.codeFrom(this.i);
		const nextText = next ? this.text(next) : '';
		if (!next || (nextText !== ';' && !continuationKeywords.has(nextText))) {
			const trailing = this.trailingComment();
			if (trailing !== undefined) {
				parent.spacer.trailingComment(trailing);
			}
			this.flushStatement(parent);
		}
	}

	// pushes the current statement (if any) onto the frame's output and resets its
	// per-statement accumulators
	private flushStatement(frame: StmtFrame): void {
		if (frame.spacer.parts.length > 0) {
			frame.out.push({
				doc: frame.spacer.parts,
				forced: frame.spacer.forced,
				lead: deriveLead(frame.leads, this.source),
			});
		}
		frame.spacer = new Spacer();
		frame.leads = [];
		frame.space = false;
	}

	private text(t: Token): string {
		return this.source.slice(t.start, t.end);
	}

	// the next code token (skipping whitespace and comments) at or after `start`
	private codeFrom(start: number): Token | undefined {
		for (let k = start; k < this.tokens.length; k++) {
			const t = this.tokens[k];
			if (t.kind !== 'whitespace' && t.kind !== 'lineComment' && t.kind !== 'blockComment') {
				return t;
			}
		}
		return undefined;
	}

	// true when the current `?` is an optional marker (`meta?:`, `a?: T`, `m?()`,
	// `a?,`) rather than the start of a ternary
	private optionalMarker(t: Token): boolean {
		if (t.kind !== 'punctuator' || this.text(t) !== '?') {
			return false;
		}
		const next = this.codeFrom(this.i + 1);
		if (next === undefined) {
			return false;
		}
		const nextText = this.text(next);
		// a ternary always needs a consequent after `?`, so `?:`, `?,` and `?)`
		// can only be optional markers
		if (nextText === ')' || nextText === ',' || nextText === ':') {
			return true;
		}
		// `?(` is ambiguous between an optional method (`m?()`) and a parenthesised
		// ternary consequent (`c ? (x) : y`); like `<`/`>`, leave the call to the
		// author's spacing — a marker is written tight, with no gap before the `(`
		return nextText === '(' && this.tokens[this.i + 1] === next;
	}

	// consumes and returns a line comment that trails the cursor on the same line
	// (no newline before it), or undefined; used to keep `x; // note` together
	private trailingComment(): string | undefined {
		let k = this.i;
		const ws = this.tokens[k];
		if (ws?.kind === 'whitespace') {
			if (ws.newlines !== 0) {
				return undefined;
			}
			k++;
		}
		const c = this.tokens[k];
		if (c?.kind === 'lineComment') {
			this.i = k + 1;
			return this.text(c);
		}
		return undefined;
	}

	private joinStatements(statements: Statement[], topLevel: boolean): Doc {
		const out: Doc[] = [];
		for (let k = 0; k < statements.length; k++) {
			if (k > 0) {
				out.push(line);
				if (topLevel && blankBetween(statements[k - 1].lead, statements[k].lead)) {
					out.push(line);
				}
			}
			out.push(statements[k].doc);
		}
		return out;
	}
}

// the leading keyword of a statement, looking past `export`/`default` to the
// declaration they modify (so `export default function` leads with `function`)
const deriveLead = (leads: Token[], source: string): string => {
	const word = (t: Token | undefined): string =>
		t && t.kind === 'identifier' ? source.slice(t.start, t.end) : '';
	const first = word(leads[0]);
	if (first !== 'export' && first !== 'default') {
		return first;
	}
	const second = word(leads[1]);
	if (first === 'export' && second === 'default') {
		return word(leads[2]) || second;
	}
	return second || first;
};

const blankBetween = (prevLead: string, lead: string): boolean => {
	if (prevLead === 'import' && lead !== 'import') {
		return true;
	}
	return declarationKeywords.has(lead);
};

/**
 * builds the layout {@link Doc} for a token stream, applying kempt's canonical policy: blocks always expand, a
 * paren/bracket/object interior breaks by width only when it is a comma-separated list (a single-item
 * interior has no meaningful breakpoint and stays flat, so an overlong expression with no list is left long
 * rather than partially reflowed), top-level blank lines are inserted around imports and declarations, and
 * the only places a line may break are bracket interiors and commas — so a break can never land in an
 * ASI-sensitive spot.
 *
 * @param tokens the lossless token stream from the lexer
 * @param source the original source the tokens index into
 * @returns the document to render with the printer
 */
export const build = (tokens: Token[], source: string): Doc => new Builder(tokens, source).build();
