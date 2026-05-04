# PDF Test Fixtures

Binary PDF fixtures are generated at test time into `tmp/` so that fixture intent
stays reviewable in source. The generated set currently covers:

- redaction text/image/vector policy behavior
- render-diff roundtrip placement
- page reorder, duplicate, rotation, and mixed page geometry

When adding a permanent fixture, document the exact assertions it protects here.
