/**
 * a document in the intermediate representation the layout builder produces and the printer renders. a `Doc`
 * is either literal text (a `string`), a sequence (an array, concatenated in order), or one of the layout
 * commands below.
 *
 * the model follows Prettier's: {@link group}s try to lay their contents out flat and fall back to broken when
 * they would exceed the line width, and the `line` family decides what whitespace a break produces.
 */
export type Doc = Doc[] | DocCommand | string;

type DocCommand = BreakParent | Group | Indent | IndentIfBreak | Line;

interface BreakParent {
	type: 'breakParent';
}

interface Group {
	contents: Doc;
	/** optional handle so an {@link indentIfBreak} can indent only when this group breaks. */
	id?: number;
	/**
	 * measure fit against this group's own contents alone, ignoring the line that continues after it. a bracket
	 * group breaks only for width problems inside its own construct, never to make an unbreakable suffix (a
	 * ternary or operator tail kempt does not lay out) fit.
	 */
	selfScoped: boolean;
	/** set via {@link group}'s option, as {@link build} does, or by {@link propagateBreaks}; forces broken mode. */
	shouldBreak: boolean;
	type: 'group';
	/**
	 * whether exceeding the line width may break this group. a bracket interior with no list separator has no
	 * meaningful breakpoint, so it stays flat under width pressure and only a forced break (`shouldBreak`)
	 * expands it.
	 */
	widthBreakable: boolean;
}

interface IndentIfBreak {
	contents: Doc;
	id: number;
	type: 'indentIfBreak';
}

interface Indent {
	contents: Doc;
	type: 'indent';
}

interface Line {
	/** always breaks, even in flat mode, and forces enclosing groups to break. */
	hard: boolean;
	/** produces nothing (not a space) when flat. */
	soft: boolean;
	type: 'line';
}

/** options controlling how a {@link Doc} renders to text. */
export interface PrintOptions {
	/** columns a single indent level occupies when measuring fit (and the space count when not using tabs). */
	indentWidth: number;
	/** the column the printer tries to keep lines within. */
	lineWidth: number;
	/** indent with tab characters rather than spaces. */
	useTabs: boolean;
}

// #region builders

/** a break that is a space when flat and a newline when broken. */
export const line: Line = { hard: false, soft: false, type: 'line' };

/** a break that is nothing when flat and a newline when broken. */
export const softline: Line = { hard: false, soft: true, type: 'line' };

/** a break that is always a newline and forces every enclosing group to break. */
export const hardline: Line = { hard: true, soft: false, type: 'line' };

/** forces every enclosing group to break without emitting anything itself. */
export const breakParent: BreakParent = { type: 'breakParent' };

/**
 * groups `contents` so the printer lays them out on one line when they fit and breaks every `line` within
 * them otherwise.
 *
 * @param contents the document to group
 * @param options `shouldBreak` forces broken mode; `id` lets an {@link indentIfBreak} key off this group
 * @returns the group command
 */
export const group = (
	contents: Doc,
	options: { id?: number; selfScoped?: boolean; shouldBreak?: boolean; widthBreakable?: boolean } = {},
): Group => ({
	contents,
	id: options.id,
	selfScoped: options.selfScoped ?? false,
	shouldBreak: options.shouldBreak ?? false,
	type: 'group',
	widthBreakable: options.widthBreakable ?? true,
});

/**
 * indents `contents` by one level for any newline produced inside it.
 *
 * @param contents the document to indent
 * @returns the indent command
 */
export const indent = (contents: Doc): Indent => ({ contents, type: 'indent' });

/**
 * indents `contents` by one level only if the group with the given `id` broke; otherwise emits them at the
 * current level. Used so a call that stays on one line while hugging a broken block argument does not
 * over-indent the block.
 *
 * @param contents the document to conditionally indent
 * @param id the id of the group whose mode decides the indent
 * @returns the conditional-indent command
 */
export const indentIfBreak = (contents: Doc, id: number): IndentIfBreak => ({
	contents,
	id,
	type: 'indentIfBreak',
});

// #endregion

const Mode = {
	break: 2,
	flat: 1,
} as const;
type Mode = (typeof Mode)[keyof typeof Mode];

/**
 * marks every group that contains a forced break (a {@link hardline} or {@link breakParent}) as `shouldBreak`,
 * so the printer never tries to lay it out flat. Mutates the groups in `doc` in place; run once before
 * printing.
 *
 * @param doc the document to scan
 * @returns whether `doc` forces a break in its enclosing group
 */
// build resolves every group's break as it constructs the document, so the
// format path never calls this; it exists for the printer's unit tests, which
// assemble documents by hand
export const propagateBreaks = (doc: Doc): boolean => {
	// a container (an array or a group/indent/indentIfBreak wrapper) being walked:
	// `forced` accumulates whether any child has forced a break so far, `i` is the
	// next child to visit. an explicit stack avoids overflowing the call stack on
	// deeply nested documents; leaf nodes (strings, lines, breakParent) never get a
	// frame, so only containers allocate
	interface Frame {
		forced: boolean;
		i: number;
		node: Doc[] | Group | Indent | IndentIfBreak;
	}
	const stack: Frame[] = [];

	// folds a child into the walk: a container is pushed and -1 returned (process it
	// before the parent continues); a leaf returns 1 if it forces a break, else 0
	const enter = (node: Doc): number => {
		if (typeof node === 'string') {
			return 0;
		}
		if (Array.isArray(node)) {
			if (node.length === 0) {
				return 0;
			}
			stack.push({ forced: false, i: 0, node });
			return -1;
		}
		if (node.type === 'breakParent') {
			return 1;
		}
		if (node.type === 'line') {
			return node.hard ? 1 : 0;
		}
		// a group/indent/indentIfBreak wrapper is walked through its single child
		stack.push({ forced: false, i: 0, node });
		return -1;
	};

	let rootForced = enter(doc);
	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		const node = frame.node;
		const count = Array.isArray(node) ? node.length : 1;
		if (frame.i < count) {
			const child = Array.isArray(node) ? node[frame.i] : node.contents;
			frame.i++;
			// evaluate every child so nested groups are all marked, never short-circuited
			const r = enter(child);
			if (r === 1) {
				frame.forced = true;
			}
			continue;
		}
		stack.pop();
		const forced = frame.forced;
		if (!Array.isArray(node) && node.type === 'group' && forced) {
			node.shouldBreak = true;
		}
		// a group's own preset shouldBreak (e.g. an always-expanded block) does not
		// propagate to its parent, so an enclosing call can still hug a broken block
		// argument: only the children's forced flag bubbles up
		if (stack.length > 0) {
			stack[stack.length - 1].forced ||= forced;
		} else {
			rootForced = forced ? 1 : 0;
		}
	}
	return rootForced === 1;
};

const width = (text: string): number => {
	const nl = text.lastIndexOf('\n');
	// a multi-line literal contributes only the width of its last line to the
	// current column; its earlier lines are their own concern
	return nl === -1 ? text.length : text.length - nl - 1;
};

/**
 * renders a {@link Doc} to its final string, breaking groups that would exceed {@link PrintOptions.lineWidth}.
 *
 * forced breaks must already be resolved (every group's `shouldBreak` is set): {@link build} does this as it
 * constructs the document, so the format path needs no separate pass.
 *
 * @param doc the document to render, with `shouldBreak` already propagated
 * @param options the rendering options
 * @returns the formatted text
 */
export const printDoc = (doc: Doc, options: PrintOptions): string => {
	const { indentWidth, lineWidth, useTabs } = options;
	const unit = useTabs ? '\t' : ' '.repeat(indentWidth);
	// indent strings are reused across the many breaks at each level
	const indents: string[] = [''];
	const indentAt = (level: number): string => {
		let s = indents[level];
		if (s === undefined) {
			s = unit.repeat(level);
			indents[level] = s;
		}
		return s;
	};
	const columnOf = (level: number): number => level * indentWidth;

	const out: string[] = [];
	let pos = 0;
	// a break emits the newline immediately but holds its indent until real
	// content follows, so a line that ends up empty (a blank line, the line
	// before a closer, end of output) never leaves trailing whitespace — which
	// is why the caller needs no per-line right-trim
	let pendingIndent = -1;
	const flushIndent = (): void => {
		if (pendingIndent > 0) {
			out.push(indentAt(pendingIndent));
		}
		pendingIndent = -1;
	};
	// records how each id'd group resolved, so an indentIfBreak can consult it.
	// ids are dense integers (the builder hands them out from 0), so a plain
	// array indexes faster than a Map
	const groupModes: Mode[] = [];

	// the work stack, held as parallel arrays rather than a stack of `{ doc, indent,
	// mode }` records: every pushed node would otherwise allocate one, millions over
	// a large file. `n` is the live length
	const stackDocs: Doc[] = [doc];
	const stackIndents: number[] = [0];
	const stackModes: Mode[] = [Mode.break];
	let n = 1;

	// scratch for fits(); reused across calls (fits runs to completion and never
	// re-enters) so the lookahead allocates nothing. indent is irrelevant to width
	// — a break ends the line and returns at once — so only docs and modes are kept
	const fitDocs: Doc[] = [];
	const fitModes: Mode[] = [];
	// whether laying `contents` (in `groupMode`) flat, then the work already on the
	// stack below `restLen`, keeps the current line within `remaining` columns
	const fits = (remaining: number, contents: Doc, groupMode: Mode, restLen: number): boolean => {
		let left = remaining;
		fitDocs[0] = contents;
		fitModes[0] = groupMode;
		let top = 1;
		let restIndex = restLen - 1;
		while (left >= 0) {
			if (top === 0) {
				if (restIndex < 0) {
					return true;
				}
				fitDocs[0] = stackDocs[restIndex];
				fitModes[0] = stackModes[restIndex];
				restIndex--;
				top = 1;
				continue;
			}
			top--;
			const d = fitDocs[top];
			const mode = fitModes[top];
			if (typeof d === 'string') {
				if (d.includes('\n')) {
					// a literal newline ends the line, so everything so far fits
					return true;
				}
				left -= d.length;
				continue;
			}
			if (Array.isArray(d)) {
				for (let i = d.length - 1; i >= 0; i--) {
					fitDocs[top] = d[i];
					fitModes[top] = mode;
					top++;
				}
				continue;
			}
			switch (d.type) {
				case 'breakParent': {
					break;
				}
				case 'group': {
					fitDocs[top] = d.contents;
					fitModes[top] = d.shouldBreak ? Mode.break : mode;
					top++;
					break;
				}
				case 'indent':
				case 'indentIfBreak': {
					// measuring flat, so the indent contributes nothing
					fitDocs[top] = d.contents;
					fitModes[top] = mode;
					top++;
					break;
				}
				case 'line': {
					if (mode === Mode.break || d.hard) {
						return true;
					}
					if (!d.soft) {
						left -= 1;
					}
					break;
				}
			}
		}
		return false;
	};

	while (n > 0) {
		n--;
		const current = stackDocs[n];
		const ind = stackIndents[n];
		const mode = stackModes[n];
		if (typeof current === 'string') {
			if (current.length > 0) {
				flushIndent();
				out.push(current);
				pos = current.includes('\n') ? width(current) : pos + current.length;
			}
			continue;
		}
		if (Array.isArray(current)) {
			// push children right-to-left so the leftmost is popped first
			for (let i = current.length - 1; i >= 0; i--) {
				stackDocs[n] = current[i];
				stackIndents[n] = ind;
				stackModes[n] = mode;
				n++;
			}
			continue;
		}
		switch (current.type) {
			case 'breakParent': {
				break;
			}
			case 'group': {
				// the rest of the work is exactly the stack below `n` (the group is
				// already popped), so fits measures the line as it would continue — unless
				// the group is self-scoped, which measures its own contents alone so an
				// unbreakable suffix can never crack it open. a group that is not
				// width-breakable only breaks when forced, never to chase the line width
				const restLen = current.selfScoped ? 0 : n;
				const resolved =
					current.shouldBreak ||
					(current.widthBreakable && !fits(lineWidth - pos, current.contents, Mode.flat, restLen))
						? Mode.break
						: Mode.flat;
				if (current.id !== undefined) {
					groupModes[current.id] = resolved;
				}
				stackDocs[n] = current.contents;
				stackIndents[n] = ind;
				stackModes[n] = resolved;
				n++;
				break;
			}
			case 'indentIfBreak': {
				stackDocs[n] = current.contents;
				stackIndents[n] = groupModes[current.id] === Mode.break ? ind + 1 : ind;
				stackModes[n] = mode;
				n++;
				break;
			}
			case 'indent': {
				stackDocs[n] = current.contents;
				stackIndents[n] = ind + 1;
				stackModes[n] = mode;
				n++;
				break;
			}
			case 'line': {
				if (mode === Mode.flat && !current.hard) {
					if (!current.soft) {
						flushIndent();
						out.push(' ');
						pos += 1;
					}
				} else {
					out.push('\n');
					pendingIndent = ind;
					pos = columnOf(ind);
				}
				break;
			}
		}
	}
	return out.join('');
};
