#!/usr/bin/env bash
prev=""
end=$((SECONDS + 300))
while [ $SECONDS -lt $end ]; do
  state=$(gh pr view 267 --json state,mergeable,mergedAt --jq '.state + " " + .mergeable + " " + (.mergedAt // "null")')
  cur="$state"
  if [ "$cur" != "$prev" ]; then
    echo "$cur"
    prev="$cur"
  fi
  if echo "$cur" | grep -q "MERGED\|null false"; then
    :
  fi
  case "$state" in
    "MERGED"*) echo "PR MERGED"; exit 0 ;;
    "CLOSED"*) echo "PR CLOSED"; exit 0 ;;
  esac
  sleep 30
done
echo "TIMEOUT: no change observed in 5 minutes, last state: $prev"
