// @req FR-087 — the Project edit path must never rewrite a field the editor did
// not touch.
// @spec ADR-036 D3
// @tested tests/unit/project-status-options.test.js
import { PROJECT_STATUSES } from '@/lib/validation/enums'

/**
 * The option values a Project status `<select>` must offer, given what is
 * actually stored on the row.
 *
 * Plain `.js` with no JSX so a test can import it directly; the modal that uses
 * it is `.jsx` and would drag React in.
 *
 * A `<select>` whose `value` matches none of its options does not stay blank —
 * the browser selects the first option, and the next submit writes THAT. So a
 * stored value the enum does not contain silently becomes `PLANNED` on the next
 * save of an unrelated field.
 *
 * This is not hypothetical. Every application write path validates through
 * `zProjectStatus` (`createProject` and `updateProject` both `.parse()`), yet a
 * production Project held `IN_PROGRESS` — a `WORK_STATUSES` value, never a
 * Project one. It arrived around the API rather than through it, which is
 * exactly the case boundary validation cannot catch: the guard is correct and
 * the row is still wrong. Rendering the stored value keeps the damage visible
 * instead of letting an unrelated edit erase it.
 *
 * The unrecognized value is offered so the field can show the truth, not so it
 * can be saved: submitting it is rejected by `zProjectStatus`, which is the
 * loud failure this replaces the silent one with.
 *
 * @param {string|null|undefined} storedStatus the Project's persisted status
 * @returns {string[]} option values, unrecognized stored value first when present
 */
export function projectStatusOptions(storedStatus) {
  return unrecognizedProjectStatus(storedStatus)
    ? [storedStatus, ...PROJECT_STATUSES]
    : [...PROJECT_STATUSES]
}

/**
 * The stored status when it is not a declared Project status, else null.
 *
 * @param {string|null|undefined} storedStatus
 * @returns {string|null}
 */
export function unrecognizedProjectStatus(storedStatus) {
  return storedStatus && !PROJECT_STATUSES.includes(storedStatus) ? storedStatus : null
}
