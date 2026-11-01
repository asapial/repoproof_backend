// Historical RPF-003 smoke is disabled under the current $0 goal.
// A local flag or key is not proof of provider-enforced no-charge limits.
console.error(JSON.stringify({ status: "DISABLED", reason: "NO_VERIFIED_ZERO_CHARGE_ENTITLEMENT", requests: 0, retries: 0 }));
process.exitCode = 1;
