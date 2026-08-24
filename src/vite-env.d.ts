/// <reference types="vite/client" />

// Standard Vite + TypeScript environment file, previously missing from this
// project. It types Vite's own import suffixes — `?raw`, `?url`, `?worker` —
// and `import.meta.env`. Added when the comment-format contract test needed to
// pull a fixture in with `?raw`: the alternative was `node:fs`, which would
// have meant adding `@types/node` as a dependency just to read one file.
