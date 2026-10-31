# Core rebuild measurement

The 2026-10-31 MSI run compares the committed `1e3d3aa` source checkout with
the manifest-index implementation using the same hash-pinned base and overlays.
The previous loop scanned 2,968 manifest rows for every retained ZIP entry;
the new implementation builds one ordinal, case-sensitive dictionary.

| Measurement | Previous | Indexed |
| --- | ---: | ---: |
| Full rebuild wall time | 183.174 s | 20.500 s |
| Sampled process CPU time | 173.203 s | 18.953 s |
| Observed peak process working set | 171.02 MiB | 171.41 MiB |

This one sequential local pair reduced elapsed time by 88.81%. It does not
establish a general development/model speed improvement, statistical variance,
or reduced memory usage. The 200 ms sampling covers the rebuild PowerShell
process, not total machine memory. Both runs use Windows PowerShell 5.1.

All 2,970 payload entries have identical SHA256 values. Their manifests match
except `createdUtc`; ZIP timestamps also differ. Both passed the existing full
bundle validation before publication. The core ZIP and Complete installer
already pinned by the release lock remain the delivery candidates.

`tests/validate-core-rebuild.ps1` exercises the real builder with small isolated
bundles: valid output, case mismatch, and duplicate manifest entries. Rejected
rebuilds preserve an existing output even with `-Force`. These checks are part
of `tests/validate.ps1`, which passed under Windows PowerShell 5.1.

To reproduce, use two separate source checkouts, the base ZIP identified in
`msi-20261031.json`, and an existing output directory outside both checkouts:

```powershell
./runtime/benchmarks/rebuild-v1/measure.ps1 -SourceRoot <Checkout> -BaseBundlePath <PinnedBaseZip> -OutputDirectory <ExistingDirectory> -Label <UniqueLabel>
```

The harness refuses to overwrite a prior measurement. Its child receives only
the Windows PowerShell module path so a PowerShell 7 parent cannot shadow the
5.1 standard modules. It does not install packages or alter services.

The earlier architecture work is now saved in local commits `5f6567d`,
`cf2a131`, and `1e3d3aa`; this supersedes historical notes saying it was
uncommitted. A fresh Git checkout passed all 42 source-overlay hashes. The
Node CI list passed 127 tests; all seven dependency-gated handoff tests also
passed when given the installed Zod location. No push or release was performed.
