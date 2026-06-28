import { build } from './build.ts';
import { printDoc } from './doc.ts';
import { tokenize } from './lexer.ts';
import type { KemptOptions } from './options.ts';
import { resolveOptions } from './options.ts';

export type { KemptOptions } from './options.ts';

/**
 * formats JavaScript/TypeScript source code, canonicalising layout while leaving token contents untouched.
 *
 * the input is assumed to be valid and not to rely on automatic semicolon insertion.
 *
 * @param source the source text to format
 * @param options layout options; sensible defaults are used for any omitted
 * @returns the formatted source, ending in a single trailing newline (or empty for empty input)
 */
export const format = (source: string, options?: KemptOptions): string => {
	// the builder resolves every group's break, so the printer skips propagation
	const doc = build(tokenize(source), source);
	const printed = printDoc(doc, resolveOptions(options));
	// the printer never emits trailing whitespace, so all that is left is to
	// collapse trailing blank lines and end the file with exactly one newline
	return printed.trim().length === 0 ? '' : printed.replace(/\n+$/, '') + '\n';
};
