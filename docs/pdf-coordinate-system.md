# PDF Coordinate System

The app stores editor objects in normalized page coordinates:

```ts
type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

- `x` and `width` are fractions of rendered page width.
- `y` and `height` are fractions of rendered page height.
- The editor uses a top-left origin because DOM and canvas interactions are top-left based.
- The PDF engine converts to PDF page points before writing.

## Conversion

For a page with `pageWidth` and `pageHeight`:

```ts
const x = rect.x * pageWidth;
const width = rect.width * pageWidth;
const height = rect.height * pageHeight;
const y = pageHeight - rect.y * pageHeight - height;
```

## Reflow

Existing PDF text has no reliable paragraph model. PDF Studio therefore treats direct source text edits as:

1. source text selection by extracted text blocks
2. source region masking in the editor
3. true redaction in the engine
4. replacement text insertion
5. same-flow movement of downstream page slices or text objects

This keeps the result editable and searchable where possible without pretending that arbitrary PDFs are Word documents.
