# @oomfware/kempt

keeps your (generated) code presentable.

```sh
npm install @oomfware/kempt
```

kempt accepts whatever JavaScript/TypeScript code is in the wild, canonicalizes the whitespace
around it, and leaves everything else exactly as written.

it's a good option for generated code, where you just want consistent, auditable code without a
heavyweight package.

## usage

```ts
import { format } from '@oomfware/kempt';

const ugly = 'export function add(a,b){const sum=a+b;return sum;}';

console.log(format(ugly));
// export function add(a, b) {
// 	const sum = a + b;
// 	return sum;
// }
```

### options

`format` takes an optional second argument.

```ts
import { format } from '@oomfware/kempt';

format(source, {
	indentWidth: 2, // spaces per indent level (and the width a tab counts as), defaults to 2
	lineWidth: 80, // the column the formatter tries to keep lines within, defaults to 80
	useTabs: true, // indent with tabs rather than spaces, defaults to true
});
```
