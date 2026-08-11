# Test Plan

## Unit

### IDs
- human-code generation
- unique collision retry
- external ID cannot become internal PK

### Progress
Test each strategy with:
- 0 items
- partial progress
- 100%
- invalid denominator
- missing metrics
- blocked gates

### Dependency
- no self-dependency
- cycle detection
- blocked/ready evaluation

### Import
- unknown execution mode rejected
- dangling reference rejected
- duplicate human code detected
- dry run has no writes

## Integration

- portfolio → tenant → business → workspace → project creation
- mixed-mode project
- repository many-to-many
- milestone/gate linkage
- snapshot round trip

## Isolation

Seed:
```text
TNT-001 / BUS-001
TNT-002 / BUS-002
```

Verify:
- BUS-001 workspace is not returned in BUS-002 scoped query
- cross-tenant update is rejected by domain service
- portfolio roll-up receives aggregate results without mutation rights

## E2E

Routes:
- Overview
- Execution All
- Sprint
- Migration
- B2B
- B2C
- Product Launch
- Operations
- Expansion
- Project create/edit
- Import dry run
- Backup export

## Accessibility smoke

- keyboard focus
- labels on controls
- color is not sole status indicator
- no horizontal page overflow at mobile viewport
