# Percentage discounts increase the price

## Problem

At baseline commit `1066351c5b07bed024775a16af9151048a9316b2`, `applyDiscount(100, 20)` returns `120` because the percentage is added instead of subtracted. The expected result is `80`.

## Reproduction

Use the pinned baseline in a separately isolated runner, with the fixture mounted read-only and without credentials or network access. From `fixtures/discount-bug`, run:

```sh
node --test tests/issue.mjs
```

Expected: the test passes because the result is `80`. Actual on the baseline: Node TAP reports one executed test, one failure, zero skipped, exit status `1`, and `ERR_ASSERTION` with `120 !== 80`.

The issue test SHA-256 is `cedda8bd3a847c877011eeb96391924c66d5adfa49cb2e68d5e3adc2be64962a`. Baseline regression command `node --test tests/regression.mjs` passes both tests. A manual reference patch that subtracts the discount passes the unchanged issue test and both regressions. This is manual fixture evidence, not an agent verdict.
