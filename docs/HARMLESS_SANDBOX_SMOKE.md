# First harmless Vercel Sandbox smoke — RPF-SBX-003BE

This foreground operator check is separate from the older owned-fixture smoke.
It runs no repository, regression test, generated patch, installation or model.
It creates no product Run, report or verdict. RPF-004 remains IN_PROGRESS and
RPF-006A remains DEFERRED. SDK/provider observations are not independent physical
isolation evidence. The ordinary web app and workers do not import this operator.

## Authorization and scope

The full-product goal authorizes the first harmless command in the existing
Hobby account within included quota and a hard $0 cash limit. The existing
`repoproof` linked project and team must match fresh provider API data and current
quota observations. A new project, token, role, OIDC setup, paid plan, billing
setting or cloud deployment is never created by this entry point.

`integration/harmlessSandbox.ts` defaults to DISABLED without its exact operator
approval literal. It verifies fresh hash-bound quota/inventory observations,
the existing linked project, official installed CLI version, current team Hobby
plan, project ownership and zero active inventory before claiming an attempt.
The first-command milestone permits only the exact previously reviewed stopped
VM and rereads its current status without resuming it. It reads
the existing Windows keyring using Vercel CLI 54.14.0's official
auto reader. This mode does not migrate or export credentials. SDK 3.9.1's older
file-only credential reader is not used, and scope inference cannot create a
default project. Credentials stay in the host process and provider auth headers.

The operator consumes `rpf-harmless-first.claim.json` with exclusive create and
fsync before any SDK create. The fixed filename cannot be selected per retry.
It is never removed, expired or rearmed automatically. Append-only stage events
are synced before progress. Any interrupted/uncertain run requires inspecting
that claim and actual provider state; never rerun a create to recover a lost ack.

The SDK request fixes one vCPU, 2048 MB, 45-second session lifetime, deny-all
egress, nonpersistent storage, no exposed ports, no mounts and an empty command
environment. No source is uploaded. The request pins the exact provider-returned
managed image identity:
`vercel/sandbox/node@sha256:dd20407070335f1605d474df72a4fc6a42d663526d1f915387a06cdbf167c0eb`.
This pins the identifier observed for the original Node 24 image. It does not
independently attest image contents, the host kernel or isolation, and grants no
fixture or untrusted-code execution permission. All SDK calls stay pinned to the first
Session and never use parent auto-resume to run a command.

## Commands and evidence

Three fixed Node snippets do only the following:

1. Print a strict marker plus Node version, Linux platform and architecture.
2. Wait ten seconds while a provider-enforced 500 ms exec timeout must kill it.
3. Start a harmless idle process, explicitly SIGKILL it and observe its completion
   before the separate ten-second command deadline.

Raw stdout is accepted only for the strict small identity object. Other output,
stderr, null/missing exits or durations, wrong runtime/policy/identity and
contradictory cleanup fail closed. Artifacts contain command hashes, bounded
byte counts/digests and observed metadata; no raw diagnostics or credentials.
The local main operation has a 30-second bound and separate eight-second cleanup
signal. Cancellation/timeout still attempts to stop the same session in finally.
Late creation also has a cleanup handler; an unknown result stays quarantined
with the claim consumed and provider TTL as a secondary bound.

SDK 3.9.1 maps a missing streaming completion exit to zero. This adapter therefore
performs a separate command-state GET and requires the raw exit to match. It also
uses the finished cancellation handle, not the predecessor's still-null exit.
Missing observations never become successful execution.

The transport accepts only the two fixed official Sandbox API prefixes:
`https://vercel.com/api/v[23]/sandboxes` used by SDK 3.9.1 and
`https://api.vercel.com/v[23]/sandboxes` used by direct metadata reads. It
canonicalizes their mutation keys together, denies adjacent paths and redirects,
and records
mutations before sending them. Repeated creates or identical uncertain command/
kill/stop requests return a local rejection instead of sending another effect.
GET observations can repeat. There is no fallback, retry creation or paid provider.

The operator additionally reads the provider state through bounded GETs while
running and after acknowledged stop. It checks the same session, policy,
resources, no public routes/mounts/snapshot, and stopped or subsequently absent
resource. These use the same account authority through a different observation
channel; they are not an independent human/host-kernel attestation. The final
receipt always labels this boundary and `rpf004Complete=false`.

## Observed local and cloud evidence — November 3, 2026

Fresh provider API and browser observations confirm the existing Hobby team and
linked project before each cloud milestone. Initial inventory was empty across
all 24 team projects without a date filter. The API accepts at most 50 records
per Sandbox page; initial 100-record requests failed and remain recorded.
The old file-only credential presence check was insufficient because the current
CLI stores credentials in the OS keyring; installed `vercel whoami` and the
official reader confirm the actual authenticated identity.

The first operator attempt was blocked locally because the original transport
guard allowed the direct API origin while the installed SDK uses `vercel.com/api`.
Exact-byte offline SDK replay forwarded zero requests. This is a source-backed
inference, not historical packet capture. The original consumed claim and failed
receipt remain intact. Two regression cases were frozen before the origin fix,
genuinely failed and pass unchanged after canonicalizing both fixed prefixes.

The first actual VM was created and stopped with acknowledged HTTP 200 responses,
but its image metadata resolved the requested tag to a digest. Strict validation
stopped it before any command. A separate provider GET confirmed the exact named
VM stopped, with no routes, mounts, snapshot or persistence. A distinct reviewed
first-command milestone then pinned that exact digest. The exact frozen image
test also genuinely failed before the pin and passes unchanged afterward.
An explicit mock type annotation was corrected before the final freeze; both
earlier test versions and failed runs remain available.

There is no automatic retry or rearm. Each historical milestone has its own
fixed exclusive claim/events/receipt filenames. The narrow corrective entries
require the exact hash-bound prior records and explicit foreground operator
selection. The first-command entry additionally requires a fresh direct read
of the prior VM's stopped session, current Hobby plan, fresh quota and complete
zero-active team inventory. Empty lists or expiry alone authorize nothing.

The accepted cloud run completed at `2026-11-03T11:30:28.366Z`:

| Check | Actual observation |
| --- | --- |
| Runtime | Linux x64, Node v24.22.1; exact pinned image identity |
| Identity | Exit 0, 117 ms, 79 stdout bytes, zero stderr |
| Provider 500 ms deadline | Exit 137, 504 ms, no output |
| Explicit SIGKILL cancellation | Exit 137, 581 ms, no output |
| Cleanup | Acknowledged stop; no snapshot; separate same-session stopped GET |
| Resources/policy | 1 vCPU, 2048 MB, 45 seconds, deny-all, nonpersistent, no ports/mounts |

Raw command-state GETs separately confirm the SDK completion exits, including
the finished cancellation handle. The receipt's SHA-256 is
`62b9a061b185bc7242b94c27bdb29937ca00e490d5187248589d00c6158c94f0`.
Final read-only inventory at `2026-11-03T11:32:05.856Z` enumerates all 24 projects
and both known stopped records: zero active or unknown Sandboxes. There were two
actual VM creations in total, one active at a time, and only three harmless guest
commands. No repository fixture, test or patch ran. No application secret was
sent to the guest and no Meta inference occurred.

Before the accepted run, actual usage displayed 1/5000 creations, 1 second/5 hours
CPU, 0.03/420 GB-hours memory, 1.48 kB/20 GB transfer and 0/15 GB snapshots. The
admission record rounds CPU, memory and transfer upward conservatively. This is
included Hobby usage, not a claim that resource consumption is zero. Vercel's
[Hobby no-overage policy](https://vercel.com/docs/sandbox/pricing) pauses creation
at its quota and charges no additional usage. No plan, billing or deployment
setting changed; cash spend is $0.

Host Node 24.22.2: clean lockfile install; 35 focused synthetic tests, included in
815 full tests across 59 files; lint, source/operator types, normal/Function
builds, eight current/pinned frontend contracts, lint-toolchain and zero full/
production audit findings pass. The earlier memory-fixture and generated-Function
lint failures were corrected in separate RPF-TEST-006BE/007BE commits. No failed
gate was ignored or counted as a pass. Frozen origin and image test hashes are
`9a29d71dd7bbb0ac0313b19205ff17da8a5284918b1fda49a41764e615b312df`
and `3b71c54f58654eaaf3b3f0195af8faf838aefced0a58806732cb2ec190e0c9f3`.

Evidence remains outside Git under `output/full-product-2026-11-02/evidence/`:
`harmless-*`, `provider-harmless-*` and the three exclusive
`rpf-harmless-*.claim.json`/events/receipt chains. The web app remains unconnected
to this foreground operator. RPF-004 independent observable isolation, actual
owned-fixture execution and the full product pipeline remain incomplete.
