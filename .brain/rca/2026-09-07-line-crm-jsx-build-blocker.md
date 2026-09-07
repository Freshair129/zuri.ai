# LINE CRM conditional JSX blocks production compilation

## Symptom

The first production build of the execution-trace worktree fails parsing
LineCrmLiveChat.jsx at the third-column JSX comment and LineCrmMembers.jsx
at the closing map expression.

## Evidence

The worktree starts at b17e7258. Both files were unchanged when `npm run build`
failed. Their most recent source change is 10ec60a4. LiveChat's active-chat
ternary returns two sibling div elements without a fragment. Members closes
the map with `))}` before closing the enclosing ternary with `)}`.

## Root Cause

Unbalanced JSX grouping introduced when adding empty-state conditionals.
The compiler rejects the entire CRM import chain before application build.

## Why the issue escaped detection

The execution trace tests do not import the CRM UI. The upstream validation
history was not verified; no claim is made about its CI outcome.

## Proposed prevention

Keep production compilation as a required release gate. The surgical fix adds
a fragment around the two active-chat columns and removes the premature map
brace. No rendering behavior, data access or styling is changed.

## Validation

Initial failure reproduced by `npm run build`; corrected build result is
recorded in the FR-171 phase report after verification.
