# Installs observer files only; never starts/stops services or deletes logs.
#Requires -Version 5.1
[CmdletBinding()]
param([string]$HeadlessRoot=(Join-Path $env:USERPROFILE '.openchatx-mcp\headless'))
$ErrorActionPreference='Stop'
$files=@('runtime-readiness.ps1','audit-retention.mjs','audit-retention-policy.json','status-headless.ps1','Watch-OpenChatXHealth.ps1')
$root=[IO.Path]::GetFullPath($HeadlessRoot)
$mutex=[Threading.Mutex]::new($false,'Local\Naos.OpenChatX.HealthWatch')
$owns=$false;$records=@()
try {
    try{$owns=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owns=$true}
    if(-not $owns){throw 'Health watcher is active; no observer files changed.'}
    $cursor=$root
    while($cursor){
        if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked observer root refused.'}
        $parent=Split-Path -Parent $cursor
        if(-not $parent -or $parent -eq $cursor){break};$cursor=$parent
    }
    $backup=Join-Path $root ('backups\health-observers-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup -Force|Out-Null
    foreach($name in $files){
        $target=[IO.Path]::GetFullPath((Join-Path $root $name))
        if(-not $target.StartsWith(($root.TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Observer target escaped root.'}
        if((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Linked observer target refused.'}
        $source=Join-Path $PSScriptRoot ('headless\'+$name)
        $before=$null
        if(Test-Path -LiteralPath $target){$before=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash;Copy-Item -LiteralPath $target -Destination (Join-Path $backup $name)}
        $after=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $temporary=$target+'.update-'+[guid]::NewGuid().ToString('N')
        Copy-Item -LiteralPath $source -Destination $temporary
        $records+=[pscustomobject]@{Name=$name;Target=$target;Temporary=$temporary;Before=$before;After=$after}
    }
    $records|Select-Object Name,Before,After|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding UTF8
    try {
        foreach($record in $records){
            $current=if(Test-Path -LiteralPath $record.Target){(Get-FileHash -LiteralPath $record.Target -Algorithm SHA256).Hash}else{$null}
            if($current -ne $record.Before){throw ('Observer changed during preparation: '+$record.Name)}
            if($null -ne $record.Before){[IO.File]::Replace($record.Temporary,$record.Target,(Join-Path $backup ($record.Name+'.replaced')))}
            else{[IO.File]::Move($record.Temporary,$record.Target)}
        }
        foreach($record in $records){if((Get-FileHash -LiteralPath $record.Target -Algorithm SHA256).Hash -ne $record.After){throw 'Observer verification failed.'}}
    } catch {
        $failure=$_
        foreach($record in $records){
            if(-not(Test-Path -LiteralPath $record.Target)){continue}
            if((Get-FileHash -LiteralPath $record.Target -Algorithm SHA256).Hash -ne $record.After){continue}
            if($null -eq $record.Before){Remove-Item -LiteralPath $record.Target -Force}
            else{Copy-Item -LiteralPath (Join-Path $backup $record.Name) -Destination $record.Temporary -Force;[IO.File]::Replace($record.Temporary,$record.Target,(Join-Path $backup ($record.Name+'.failed-new')))}
        }
        throw $failure
    }
    Write-Output ('OBSERVER_BACKUP='+$backup)
    Write-Output ('OBSERVER_FILES_VERIFIED='+$records.Count)
} finally {
    foreach($record in $records){if(Test-Path -LiteralPath $record.Temporary){Remove-Item -LiteralPath $record.Temporary -Force}}
    if($owns){$mutex.ReleaseMutex()};$mutex.Dispose()
}
