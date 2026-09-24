#!/bin/sh
# All suites. Run after any ingestion change.
set -e
for t in test_engine test_501 test_pfb test_membership; do
  printf "%-18s " "$t"
  node "ingest/$t.mjs" > /tmp/$t.out 2>&1 && tail -1 /tmp/$t.out || { echo "FAILED"; cat /tmp/$t.out; exit 1; }
done
