# Pinned read-only GitHub transport — RPF-INTAKE-002

OwnedGitHubIntake adds a bounded transport in front of RPF-INTAKE-001. It accepts
no repository, URL, branch, path, token, request headers or executable command
from a user/model. Server code must explicitly supply its read transport; there
is no default fetch or credential discovery. No HTTP route is registered.

## Exact scope and provenance

The only target is asapial/repoproof_backend at commit
1066351c5b07bed024775a16af9151048a9316b2, tree
79af84b2571665ed61b0bfe4ac00020cd1a0e8a3, and issue number 1. Tree/blob pins were
independently read from that existing local Git object with rev-parse/ls-tree,
without checkout or execution. Three regular 100644 fixture blobs are allowed:

- src/discount.mjs: dc273c1d9e967465bc2a3df894f1a0b21736e1e2
- tests/issue.mjs: 88a111206f45d05541c1999c8339343e9b6c97fb
- tests/regression.mjs: f3756fba8c5f6b104a7c11a86847b2f4356731cd

Every load performs at most six fixed GETs: commit object, complete recursive
tree, the three exact blobs and the owned issue. It never follows API response
URLs, download links, redirects, branch refs or pagination. Truncated trees,
duplicate/unsafe paths, missing/extra identity, symlinks, executable modes and
submodules at selected paths fail closed. Blob base64 must be canonical after
GitHub's documented line wrapping; decoded length, Git blob SHA-1 and independently
pinned SHA-256 must all match. The reviewed local orchestration manifest stays
byte-pinned; its historical tracking fields are not fetched from the public base
or treated as fresh execution evidence.

REST version 2026-03-10 is explicit. Official references checked November 2,
2026: [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions),
[Git commits](https://docs.github.com/en/rest/git/commits),
[trees](https://docs.github.com/en/rest/git/trees),
[blobs](https://docs.github.com/en/rest/git/blobs), and
[issues](https://docs.github.com/en/rest/issues/issues). Git database endpoints
support public reads without authentication. Read-only transport does not grant
inference, runner, billing or remote-write permission.

## Boundaries

Requests omit credentials/Authorization and use GET, redirect:error, no-store,
a fixed accept/version/User-Agent and one total deadline (default 5s, maximum
10s). Header waits, body reads, all six requests and parsing share that deadline;
monotonic checks also reject synchronous work finishing after it. There are no
retries or partial snapshot fallback. Abort propagates, late responses are
cancelled, and stalled cancellation promises cannot hold the operation open.

Response caps are 32 KiB commit, 512 KiB tree (2,048 entries), 64 KiB blob JSON
and 128 KiB issue JSON. Source bytes are capped again at 24,000 each. Declared
length is checked and actual streamed/decompressed bytes are independently
bounded before parsing. Only expected JSON media types are accepted. Fixed error
codes do not expose response bodies, URLs from errors, credentials or raw errors.

readStrictJson first applies standard JSON syntax, then the already pinned
Babel parser inspects object keys as inert AST. It rejects escaped duplicate
keys, prototype-related keys, unsupported structures, nonfinite numbers, excess
depth/nodes, invalid UTF-8 and overflow. This permits normal GitHub whitespace
without accepting JSON.parse's ambiguous duplicate-key behavior. It evaluates
nothing. Normal API extension fields are ignored after bounded structural checks;
they never become permissions, paths, code or evidence.

Issue identity/URLs must match the owned issue, and pull-request responses are
rejected. Title/body remain bounded untrusted data. Final bytes pass through the
existing digest/AST/immutable intake, whose networkVerified=false deliberately
remains: an injected transport or synthetic HTTP transcript is not independent
network/provenance proof. No test, package script, repository source, Git command
or archive is executed by the client.

## Evidence and remaining integration

Tests use synthetic HTTP only and exact fixture bytes as data. They cover six
fixed read requests, credential omission, altered Git/source/issue identities,
mode/traversal/base64/content attacks, duplicate JSON keys, redirect/URL attacks,
HTTP errors without retries, media/length/stream overflow, stalled headers/body,
late response cleanup, total deadline, cancellation and safe errors.
No live repository/API request, Meta call, Sandbox creation or source execution occurred.
Live GitHub transport behavior, authenticated run ownership, actual reporter/
runner provenance and full issue verification are separate parent integrations.
RPF-012A remains TODO, RPF-004 IN_PROGRESS and RPF-006A DEFERRED.
