#!/usr/bin/env bash
prev=""
while true; do
  cur=$(gh pr checks 267 --json name,bucket --jq '.[] | .name + ": " + .bucket' | sort)
  if [ "$cur" != "$prev" ]; then
    echo "$cur"
    prev="$cur"
  fi
  pending_count=$(echo "$cur" | grep -c "pending")
  if [ "$pending_count" = "0" ]; then
    echo "ALL CHECKS TERMINAL"
    break
  fi
  sleep 45
done
