[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SourceRoot,[Parameter(Mandatory=$true)][string]$BaseBundlePath,[Parameter(Mandatory=$true)][string]$OutputDirectory,[Parameter(Mandatory=$true)][string]$Label)
$ErrorActionPreference='Stop'
if($Label -notmatch '^[a-z0-9-]+$'){throw 'Invalid measurement label'}
$out=Join-Path $OutputDirectory ('core-rebuild-'+$Label+'.zip')
$record=Join-Path $OutputDirectory ('core-rebuild-'+$Label+'.json')
if((Test-Path -LiteralPath $out) -or (Test-Path -LiteralPath $record)){throw 'Measurement already exists'}
$script=Join-Path $SourceRoot 'runtime/Rebuild-CoreBundle.ps1'
$base=[IO.Path]::GetFullPath($BaseBundlePath)
$stdout=Join-Path $OutputDirectory ('core-rebuild-'+$Label+'.stdout.log')
$stderr=Join-Path $OutputDirectory ('core-rebuild-'+$Label+'.stderr.log')
$arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$script+'" -BaseBundlePath "'+$base+'" -OutputPath "'+$out+'"'
$clock=[Diagnostics.Stopwatch]::StartNew()
$priorModulePath=$env:PSModulePath
try {
    # A pwsh parent can prepend incompatible PowerShell 7 modules for a 5.1 child.
    $env:PSModulePath=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules'
    $p=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
} finally {$env:PSModulePath=$priorModulePath}
$peak=0L;$cpuMs=0.0
while(-not $p.HasExited){
    $p.Refresh()
    try{$peak=[Math]::Max($peak,$p.PeakWorkingSet64);$cpuMs=$p.TotalProcessorTime.TotalMilliseconds}catch{}
    if($clock.Elapsed.TotalMinutes -gt 10){$p.Kill();throw 'Owned measurement process exceeded ten minutes'}
    Start-Sleep -Milliseconds 200
}
$p.WaitForExit();$clock.Stop()
$result=[ordered]@{label=$Label;sourceRoot=$SourceRoot;scriptSha256=(Get-FileHash -LiteralPath $script -Algorithm SHA256).Hash;wallMs=$clock.ElapsedMilliseconds;sampledCpuMs=$cpuMs;peakProcessWorkingSetBytes=$peak;exitCode=$p.ExitCode;output=$out;stdout=$stdout;stderr=$stderr;memoryScope='PowerShell rebuild process only; sampled every 200 ms; no child process aggregation';timestampUtc=[DateTime]::UtcNow.ToString('o')}
if(Test-Path -LiteralPath $out){$result.outputSha256=(Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash;$result.outputBytes=(Get-Item -LiteralPath $out).Length}
$json=$result|ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($record,$json+"`n",[Text.UTF8Encoding]::new($false))
$json
if($p.ExitCode -ne 0){Get-Content -LiteralPath $stderr;throw 'Rebuild failed'}
