# Generated Corpus

`tests/engine-corpus-100.mjs` writes the generated 100-PDF corpus to
`tmp/engine-corpus-100/` at test time. The generated files are not committed.

Run:

```bash
REQUIRE_QPDF=1 node tests/engine-corpus-100.mjs
```

The generated corpus currently covers:

- Basic text
- Contract-like layouts
- Invoice/table-like layouts
- Form-like boxed layouts
- Annotation-like callouts
- Image-heavy pages
- Vector-heavy pages
- Table-heavy pages
- Multi-column academic-style pages
- Varied large-page geometry

The generated manifest is written to:

```txt
tmp/engine-corpus-100/manifest.json
```
