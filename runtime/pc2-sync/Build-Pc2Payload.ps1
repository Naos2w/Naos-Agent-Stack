# Build only the reviewed PC2 code migration from the pinned portable candidate.
#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CoreBundlePath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if((Get-FileHash -LiteralPath $CoreBundlePath).Hash -ne 'C5529684ED996667A6290CA2E326029C15570E8B5AA9CD61E3594C197B544FA8'){throw 'BUNDLE_HASH_MISMATCH'}
if((Test-Path -LiteralPath $OutputPath) -or (Test-Path -LiteralPath ($OutputPath+'.gz.b64'))){throw 'PAYLOAD_OUTPUT_ALREADY_EXISTS'}
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$core=(Get-Content -LiteralPath (Join-Path $repo 'runtime/core-maintenance/manifest.json') -Raw|ConvertFrom-Json).files.relativePath
$observers=@('runtime-readiness.ps1','audit-retention.mjs','audit-retention-policy.json','status-headless.ps1','Watch-OpenChatXHealth.ps1')
$rows=@();$zip=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($CoreBundlePath))
try {
 foreach($entry in $zip.Entries){
  $key=$entry.FullName;$targetRoot=$null;$relative=$null
  if($key.StartsWith('runtime/') -and $core -contains $key.Substring(8)){$targetRoot='runtime';$relative=$key.Substring(8)}
  elseif($key.StartsWith('toolboxes/agent-runtime/') -and $key -notlike '*/docs/history/*'){$targetRoot='headless';$relative=$key}
  elseif($key -like 'headless/codebase-index/*.mjs' -or $key -like 'headless/core-maintenance/*' -or ($key.StartsWith('headless/') -and $observers -contains $key.Substring(9))){$targetRoot='headless';$relative=$key.Substring(9)}
  if(-not $targetRoot -or $entry.Length -eq 0){continue}
  $stream=$entry.Open();$memory=[IO.MemoryStream]::new();try{$stream.CopyTo($memory);$bytes=$memory.ToArray()}finally{$stream.Dispose();$memory.Dispose()}
  $hash=[Security.Cryptography.SHA256]::Create();try{$sha=[BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
  $rows+=[ordered]@{root=$targetRoot;path=$relative;sha256=$sha;data=[Convert]::ToBase64String($bytes)}
 }
}finally{$zip.Dispose()}
if($rows.Count -ne 74){throw 'PAYLOAD_SCOPE_CHANGED'}
$payload=[ordered]@{schema=1;host='NAOS-PC';sourceCommit='134d25c';sourceBundleSha256='C5529684ED996667A6290CA2E326029C15570E8B5AA9CD61E3594C197B544FA8';files=$rows}
$bytes=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Depth 10 -Compress))
[IO.File]::WriteAllBytes([IO.Path]::GetFullPath($OutputPath),$bytes)
$memory=[IO.MemoryStream]::new();$gzip=[IO.Compression.GZipStream]::new($memory,[IO.Compression.CompressionMode]::Compress,$true)
try{$gzip.Write($bytes,0,$bytes.Length)}finally{$gzip.Dispose()}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath+'.gz.b64'),[Convert]::ToBase64String($memory.ToArray()),[Text.Encoding]::ASCII);$memory.Dispose()
Write-Output ('PAYLOAD_FILES='+$rows.Count)
Write-Output ('PAYLOAD_SHA256='+(Get-FileHash -LiteralPath $OutputPath).Hash)
