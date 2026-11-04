# hAIul SIM: end-to-end verification (real browser, real UI)

Scope: the eleven user workflows below, driven through the running app in headless Chromium (Playwright, SwiftShader
WebGL). Every action goes through the UI: clicks, keyboard shortcuts, the native file chooser, drag-and-drop. The store
is not exposed on `window`, so where the DOM does not print a number the suite reads the app's own store / engine
modules **read-only** through the Vite dev server's module graph (same module instance the page uses), and
`window.__haiulScene` for render stats. I did not change anything under `src/`.

**Suite:** `tests/e2e/` (plain Node + Playwright, not picked up by vitest).

```bash
node tests/e2e/run.cjs --isolated        # all flows; private dev server with HMR off (recommended while src/ is being edited)
node tests/e2e/run.cjs 3 5               # selected flows against the running dev server (E2E_URL, default :5173)
```

Screenshots and `results.json` go to `E2E_OUT` (this run: the QA scratchpad `e2e/` folder). Fixtures: `E2E_TOPO`
(Vulcan topo `.00t`), `E2E_SOLID` (defaults to `src/io/__fixtures__/demo_dump_S51_lift.00t`), and string 0 of
`docs/spec/fixtures/raw-data-strings.json` written out as CSV.

__RESULTS__
