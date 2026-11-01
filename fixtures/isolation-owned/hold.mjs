// Owned timeout/cancellation probe. NEVER execute on the host.
process.stdout.write('{"version":"owned-isolation-v1","marker":"HOLD_STARTED"}\n');
// The provider's command limit / VM TTL must terminate this loop. A self-imposed
// timer would not demonstrate provider enforcement.
for (;;) { Math.imul(1234567, 7654321); }
