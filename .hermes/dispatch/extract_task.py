#!/usr/bin/env python3
"""Extract the full text of one numbered task from the plan markdown."""
import re, sys

plan = "/Users/abhinav/Desktop/Projects/UrbanCanvas/.hermes/plans/2026-08-24_190234-urban-canvas-stabilization-redesign-core-functionality.md"
n = int(sys.argv[1])
text = open(plan).read()
m = re.search(rf'(?ms)^### Task {n}:.*?(?=^### Task {n+1}:|^## |\Z)', text)
print(m.group(0).strip() if m else f"TASK {n} NOT FOUND", file=sys.stderr or sys.stdout)
