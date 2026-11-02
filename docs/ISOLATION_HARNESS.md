# Independent negative isolation harness — RPF-ISO-001

RPF-ISO-002 separately prepares [hard-resource negative probes](HARD_RESOURCE_PROBES.md).
Their assets are pinned but never host/Docker executed; synthetic observation
checks cannot satisfy RESOURCES or change RPF-004's incomplete status.

RPF-GUEST-001 prepares a separate [owned guest filesystem helper](GUEST_PREPARATION.md).
Its modeled tests and real Windows deny path do not satisfy FILESYSTEM or any
other real isolation gate below. No probe assets or frozen fixture bytes changed.

Offline preparation only. RPF-004 remains IN_PROGRESS. No owned probe has been
executed on the host, Docker Desktop or a cloud provider. Tests read/hash and
syntax-parse fixture bytes, never import/run them. Meta inference, cloud execution,
Git push and deployment remain unauthorized; budget $0. No Run/report/verdict is
created and `/runs` remains unavailable. This is not independently verified isolation.

## Owned assets and preparation

fixtures/isolation-owned contains pinned probe.mjs, hold.mjs and fail.mjs. Exact
bytes and aggregate manifest SHA-256 are in src/isolation/bundle.ts and protected
from checkout newline conversion. Existing discount-bug frozen assets are untouched.
The model patch policy also rejects the isolation directory and probe policies.
prepareIsolationProbe only constructs fixed remote file/command packets. It never
executes code, calls a provider or accepts caller shell commands, mounts or env.
The approved executor must verify these bytes again before upload and collect
runtime/source/output hashes before and after execution.

Network probes use operator-owned independently ready public IPv4/IPv6 canaries,
fixed RFC1918, link-local metadata and IPv4-mapped IPv6 targets. External TCP port
443 and private/metadata port 80 are tested without sending application data or
reading metadata contents. A loopback listener is a positive control. Successful
external/private connections fail. Refusal, routing errors, unsupported IPv6 and
timeouts alone are UNKNOWN; they cannot prove firewall enforcement. EACCES/EPERM
is a denial observation, still requiring independent policy/canary evidence.
The preparer's IP strings are not proof of ownership: a live approval must bind
actual receiver identities/readiness/logs and scope before any packet executes.

The environment probe reports only presence of known application-secret variable
names, a host-only synthetic canary path and Docker socket, plus UID. No value is
printed. The trusted Linux executor must first create its own private synthetic
canary at the exact /tmp/repoproof-controller-<nonce> path; that value never goes
to a guest. A missing controller-side control or non-Linux host means UNKNOWN.
This must run from the approved separate foreground executor, not a shared host
which executes fixture code. Guest resource facts include CPU availability and
Linux memory allocation, compared with independent provider observations.

cross_write creates an exclusive fixed guest /tmp marker containing a fresh
synthetic UUID. cross_read never receives the value. Separate serial fresh VMs
test nonpersistence. Simultaneous two-VM reads test cross-sandbox separation;
they require a distinct explicit two-sandbox approval and quota reservation.
Initial concurrency remains one. A single VM or serial-only test cannot waive
the mandatory concurrent cross-sandbox gate.

hold.mjs emits a fixed marker then deliberately waits forever. Only a provider
command limit, VM lifetime or cancellation may stop it; no self timer fakes
enforcement. It is NEVER a host test. fail.mjs emits a marker and exits 23 to
exercise failed-command cleanup. Other probes have a 5-second command limit;
hold uses 1 second. VM policy stays 1 CPU/2048 MB/30 seconds, no persistence,
deny-all, no ports/mounts/secrets and bounded 16 KiB output. Cancellation must use
an independent cleanup path and an independent observer must confirm destruction.

## Mandatory real acceptance matrix

| Gate | Required live evidence |
| --- | --- |
| EXTERNAL_V4 | Loopback control; owned receiver ready outside guest; denied guest attempts, no receiver connection; independently queried deny-all policy |
| PRIVATE_V4 | Fixed RFC1918 cases with explicit denial evidence; ambiguous refusals/timeouts remain UNKNOWN |
| METADATA | Link-local/container metadata and mapped IPv6 denied; no metadata data read |
| IPV6 | Actual IPv6 boundary evidence; unsupported guest errors alone do not pass or waive it |
| APP_SECRETS | Application/provider credentials absent, no secret value logged, independent controller-only canary inaccessible |
| FILESYSTEM | Controller host canary/socket absent; independent mount/isolation observation; runner upload/apply no-follow containment must also be proved |
| CROSS_SANDBOX | Two approved overlapping distinct VM sessions, writer marker inaccessible to reader, no shared mounts |
| RESOURCES | Effective guest CPU/memory and independent provider allocations agree; hard resource limits checked without host workload |
| TIMEOUT | Start marker, actual provider termination/exit and independent duration/lifetime observation |
| CANCELLATION_CLEANUP | Cancel during create/run, same VM stopped; late/unknown create reconciled; no orphan/snapshot |
| NONPERSISTENCE | Fresh-session marker absent, persistent=false, no unexpected snapshots/drives/files after stop |
| PROVENANCE | Authenticated identities/session/command IDs, image/source/frozen/input/output digests, ordered timestamps, both signatures and durable replay reservation |
| FAILURE_PATH | Expected owned failure plus confirmed destruction/quarantine; setup/network/timeouts never become success |

These are necessary observations, not a universal proof from a list of IPs or a
provider policy field. Guest byte hashes, SDK mocks and signed claims alone cannot
establish physical isolation. Missing provider visibility/permissions/IPv6 evidence
or free-tier capability is a blocker; do not weaken a gate to manufacture a pass.
Guest no-follow containment and actual memory-limit enforcement need additional
approved live controller checks beyond the minimal prepared probe assets.

## Independent statement validation

src/isolation/assessment.ts deliberately does not use the smoke schema or SDK.
It bounds raw bytes to 64 KiB, validates all mandatory gates and expected audit,
fixture/image/session scope, freshness and cleanup. Controller and independent
observer must use distinct approved Ed25519 keys. Signatures cover a canonical
ordered representation; swapped identities/keys, mutations and source mismatch
fail. OFFLINE_SYNTHETIC statements cannot qualify as live observations. The store
must atomically reserve both evidence IDs, nonces and audit ID using its trusted
database clock and retain identity through retry/recovery windows. Missing, replayed
or unavailable storage fails closed. A production replay store/trust registry is
not implemented by this ticket.

Matching signatures and fact hashes authenticate endorsed statements, not their
truth. Even a valid complete packet returns READY_FOR_INDEPENDENT_REVIEW with
rpf004Complete=false. No function here can mark RPF-004 complete or emit a product
VERIFIED verdict. Approved live collection, review of genuine independent facts,
durable evidence/trust registration and all mandatory acceptance remain separate.
Unit tests generate ephemeral synthetic signing keys and statements; these never
represent actual live execution despite exercising the LIVE_PROVIDER wire shape.

## Next integration and approval boundary

Wire the fixed packets only to an approved Vercel SDK controller and an independently
authenticated read-only observer. Persist raw bounded output separately from safe
logs, verify hashes and retain actual provider command IDs/state/policy/timestamps.
Record any timeout, setup failure, signature mismatch, cleanup uncertainty and
partial evidence as such. Default no-live approval/trust roots stay empty.

One consolidated later decision must cover live Hobby smoke/budget/account and
owned receiver scope, independent observer access/trust roots, the two-VM exception,
durable controller/evidence hosting, and RPF-006A resumption if desired. A Meta key
does not authorize billing; live inference additionally needs independently proven
no-charge enforcement. Other independent local components continue while these
external gates remain blocked.
