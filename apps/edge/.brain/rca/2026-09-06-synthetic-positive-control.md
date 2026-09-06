# Synthetic replay positive control

- Symptom: the original budget-only authored replacement failed the unchanged
  assertion that removing the exclusion must surface drinkware.
- Evidence: replay failed on positive query `งบ 200 บาท`; the other five replay
  tests passed. Reordering synthetic IDs did not resolve it.
- Root cause: the fixture adapter ranks by lexical overlap, and search takes the
  first three priced candidates before sorting by price. A budget-only query gives
  no product relevance signal guaranteeing drinkware among those candidates.
- Why it escaped detection: fixture generation checked counts and valid types;
  only executing the positive control measures reachability in this lexical adapter.
- Prevention: author explicit cup/notebook alternatives before excluding cups and
  retain the unchanged paired positive/negative assertions. The final six replay
  tests pass. This is a synthetic-data correction, not a production search bug fix.
