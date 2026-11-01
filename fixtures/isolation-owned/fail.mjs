// Owned failure-path probe. NEVER execute on the host.
process.stdout.write('{"version":"owned-isolation-v1","marker":"OWNED_FAILURE"}\n');
process.exit(23);
