# Phase 19 — Padhramani Household Exclusion + Unicode Escape Bug

## 1. Padhramani household list

`HouseholdPicker` (used by both `ScheduleEventModal` and `EditHouseholdsModal`
in `PadhramaniPage.jsx`) now excludes households already assigned to any
OTHER Padhramani event. Both modals fetch all `padhramaniEvents`, build a
Set of every household ID used elsewhere (excluding the event currently
being edited, so its own already-picked households stay visible), and pass
it into `HouseholdPicker` as `excludeIds`.

## 2. Literal `\u2014` / `\u00b7` / `\u2019` etc. showing as text

Root cause: JSX does not interpret backslash escape sequences in JSX text
children OR JSX attribute string literals (`attr="...\u2026..."`) — only
inside a real JS string/expression (`{'...\u2026...'}`). Every place these
escapes were typed directly as JSX text rendered the literal 6-character
sequence instead of the character.

Found and fixed with an AST-based scan (Babel parser + traverse, not
regex — regex couldn't reliably distinguish "inside a JS string" from
"bare JSX text" given how JSX mixes both on the same line) — 34 confirmed
JSXText occurrences across 15 files. Fixed by replacing every escape
sequence with its actual Unicode character directly in the source
(`\u2014` → —, `\u00b7` → ·, `\u2019` → ', `\u2026` → …, `\u2192` → →,
`\u2705` → ✅, `\u274c` → ❌, plus 5 emoji surrogate pairs) — safe
everywhere, including inside legitimate JS strings elsewhere, since a raw
UTF-8 character in a JS string literal is identical to its escaped form.

Verified with the same AST scanner afterward: zero remaining bare escapes
project-wide, confirmed against both JSXText and JSXAttribute node types.
