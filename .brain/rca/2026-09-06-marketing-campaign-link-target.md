# Marketing Campaign collection link target RCA

## Symptom

Campaign links in the rendered List and Board views navigated to a JSON API
response instead of the Campaign detail page.

## Evidence

- Agent-browser inspected the live List DOM and found the first campaign anchor
  href was `/api/growth/campaigns/<initiative>?businessId=<business>`.
- The detail page is rooted at `/growth/campaigns/<initiative>?tab=brief`, and
  the create flow already used that page route.
- The collection and Board both called `growthCampaignPath`, which is the
  server API path used by detail reads and mutations.

## Root Cause

The UI reused the API URL helper as a page-navigation helper. The two URL
contracts were not represented by separate names.

## Why the issue escaped detection

The browser smoke test asserted that a created title appeared after returning
to the collection but never activated a List or Board campaign link. The unit
test only covered the API helper value.

## Proposed prevention

Keep API and page helpers distinct (`growthCampaignPath` and
`growthCampaignPagePath`) and exercise both collection presentations through a
real click-and-detail browser assertion.
