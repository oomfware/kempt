import type { PrintOptions } from './doc.ts';

/** caller-facing options for {@link format}; every field has a default. */
export interface KemptOptions {
	/**
	 * spaces per indent level when {@link useTabs} is false, and the column a tab counts as when measuring fit.
	 * defaults to 2.
	 */
	indentWidth?: number;
	/** the column the formatter tries to keep lines within. defaults to 80. */
	lineWidth?: number;
	/** indent with tabs rather than spaces. defaults to true. */
	useTabs?: boolean;
}

/**
 * fills in defaults for any options the caller omitted.
 *
 * @param options the caller-supplied options, if any
 * @returns fully-resolved print options
 */
export const resolveOptions = (options: KemptOptions = {}): PrintOptions => ({
	indentWidth: options.indentWidth ?? 2,
	lineWidth: options.lineWidth ?? 80,
	useTabs: options.useTabs ?? true,
});
