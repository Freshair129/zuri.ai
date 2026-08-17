# RCA Standard (Root Cause Analysis)

A fix is only permanent if the root cause is understood. All bug fixes must include an RCA.

## 1. Symptom
Describe the observed failure from the user's perspective. Include screenshots or error logs.

## 2. Evidence
Provide the logs, test failures, or metrics that prove the issue exists. **Empirical reproduction is mandatory.**

## 3. Root Cause
The "Why". Trace the failure to the specific line of code or logic flow. Explain the mechanism of failure.

## 4. Escape Analysis
Why did our existing tests, linters, or CI/CD fail to catch this before it reached development/production?

## 5. Proposed Fix & Prevention
Explain the fix and how we will prevent recurrence (e.g., a new test case, a linter rule, or a type system improvement).
