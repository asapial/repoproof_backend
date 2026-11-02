# Gated owned snapshot intake — RPF-INTAKE-001

`intakeOwnedSnapshot` accepts pre-fetched inert bytes. The sole allowlisted source
identity is `asapial/repoproof_backend`, fixture `discount-bug`, commit
`1066351c5b07bed024775a16af9151048a9316b2`, curated issue number 1. It accepts only
the three exact source/reference-test/regression-test paths in fixtureDigests.
It requires regular Git blobs with mode 100644. Symlinks, submodules, executable
modes, directories, archives, extra paths, duplicates, traversals, encoded names,
case/path aliases, mutable branches and different repositories are rejected.

The existing reviewed manifest is pinned by exact SHA-256
`08b07e6a1a3bae61a58eb55430a051aa4861e5f905f0f1742fdad32778b42a21`.
This is local orchestration metadata; its later historical execution/tracking
fields are not asserted to exist at the public base commit. They are never used
as fresh execution evidence. Source/test identity comes from the pinned commit
and exact independently maintained fixtureDigests. Intake checks the manifest
digest and relevant metadata, each source/test digest and static admissibility.
No bytes, fixture hashes or historical evidence are changed.

Each input is schema-bounded before copying (manifest 16,384 bytes; each file
24,000 bytes; three files; bounded issue strings). The immutable snapshot digest
binds repository/fixture/commit/manifest, issue data and an ordered file hash
list. Internal bytes and issue metadata are private; reads/projections return
copies. Serialized handles cannot restore authority. Caller mutation cannot
alter accepted snapshots. Returned `networkVerified: false` is deliberate.

Issue title/body remain untrusted data. `ownedModelSource` projects only the
pinned source file and bounded issue into the existing Meta schema; it supplies
no execution/policy instructions, test mutations or extra model capabilities.
The provider's existing DATA_ONLY envelope remains responsible for presenting
that text as data, while deterministic downstream policies enforce constraints.
Text content never changes source allowlists, command selection or permission.

No network fetch, repository scripts, Git checkout, archive extraction or source
evaluation occurs. This ticket does not authenticate a future GitHub transport,
fetch arbitrary issues or enable run APIs. Real read-only transport, HTTP
authorization, independent runner provenance and durable snapshot storage are
separate integrations. RPF-012A/006B remain TODO, RPF-004 IN_PROGRESS and RPF-006A
DEFERRED. Unit tests use exact local bytes as data and adversarial input objects.
