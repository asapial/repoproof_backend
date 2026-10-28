# Draft issue: Percentage discounts increase the price

## Problem

In the owned discount fixture, `applyDiscount(100, 20)` should return `80`. The baseline implementation adds the percentage instead of subtracting it; its arithmetic indicates a result of `120`.

## Expected behavior

A 20 percent discount on 100 produces 80. A zero percent discount leaves the price unchanged, and a discount on zero remains zero.

## Reproduction

Run the issue-specific test in `tests/issue.mjs` with the fixed test command in `manifest.json`, using the separately isolated runner after a fixture commit is pinned. This draft is not a published GitHub issue and no issue URL is assigned.
