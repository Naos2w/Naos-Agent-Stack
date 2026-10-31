[CmdletBinding()]
param([string]$Node = 'node')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$sourceRoot=Split-Path -Parent $PSScriptRoot
$fixtureRoot=Join-Path ([IO.Path]::GetTempPath()) ('naos-health-fixture-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
try {
    $nodePath=(Get-Command $Node -ErrorAction Stop).Source
    $sourcePath=Join-Path $sourceRoot 'runtime\headless\Watch-OpenChatXHealth.ps1'
    $text=Get-Content -LiteralPath $sourcePath -Raw
    $tokens=$null;$parseErrors=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw 'HEALTH_SOURCE_PARSE_FAILED'}
    # Stub only transport/OS probes. Execute the real readiness adapter and
    # watchdog branching against isolated state, without contacting live services.
    $stubs=@{
        'Test-McpReady'='return $true'
        'Test-TunnelPresent'='return $true'
        'Get-HeadlessDiskFreeBytes'='return 10GB'
        'Get-CorePatchSnapshot'='return [pscustomobject]@{ok=$true;detail="fixture"}'
    }
    $functions=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)
    foreach($function in $functions){
        if($stubs.ContainsKey($function.Name)){
            $text=$text.Replace($function.Extent.Text,('function '+$function.Name+' { '+$stubs[$function.Name]+' }'))
        }
    }
    $quotedNode=$nodePath.Replace("'","''")
    $text=$text.Replace('Get-NaosRuntimeReadiness -HeadlessRoot $root',("Get-NaosRuntimeReadiness -HeadlessRoot `$root -Node '"+$quotedNode+"'"))
    $text=$text.Replace('Get-NaosAuditRetention -HeadlessRoot $root',("Get-NaosAuditRetention -HeadlessRoot `$root -Node '"+$quotedNode+"'"))
    $watcher=Join-Path $fixtureRoot 'Watch-OpenChatXHealth.ps1'
    [IO.File]::WriteAllText($watcher,$text)
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'runtime\headless\runtime-readiness.ps1') -Destination $fixtureRoot
    foreach($file in @('audit-retention.mjs','audit-retention-policy.json')){
        Copy-Item -LiteralPath (Join-Path $sourceRoot ('runtime\headless\'+$file)) -Destination $fixtureRoot
    }
    $toolbox=Join-Path $fixtureRoot 'toolboxes\agent-runtime'
    New-Item -ItemType Directory -Path (Join-Path $toolbox 'tools') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'runtime\lean-runtime\runtime_readiness.mjs') -Destination (Join-Path $toolbox 'tools')
    $registry=Join-Path $toolbox 'operations.json'
    foreach($case in @(
        @{body='{}';expected=0;label='HEALTHY'},
        @{body='{';expected=2;label='DEGRADED'},
        @{body='[]';expected=2;label='DEGRADED'},
        @{body='{"op":{"state":"failed","reconciliation":{"requiresReconciliation":true}}}';expected=2;label='DEGRADED'}
    )){
        [IO.File]::WriteAllText($registry,$case.body)
        $output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $watcher -CheckOnly)
        if($LASTEXITCODE -ne $case.expected -or -not($output -match ('^'+$case.label+':'))){throw ('HEALTH_READINESS_CASE_FAILED: '+$case.body+' '+($output -join ';'))}
    }
    [IO.File]::WriteAllText($registry,'{}')
    [IO.File]::WriteAllText((Join-Path $toolbox '.runtime-update-pending.json'),'{}')
    $output=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $watcher -CheckOnly)
    if($LASTEXITCODE -ne 2 -or -not($output -match 'RECOVERY_REQUIRED')){throw 'HEALTH_PENDING_NOT_BLOCKED'}
    Write-Output '[PASS] PowerShell 5.1 watchdog and Node readiness agree on healthy, corrupt, unresolved and pending states'

    # Load only the actual PM2 JSON conversion function from the offline
    # updater. Its stop/apply/restart body is deliberately never executed.
    $offlinePath=Join-Path $sourceRoot 'runtime\lean-runtime\apply-offline.ps1'
    $offline=[Management.Automation.Language.Parser]::ParseFile($offlinePath,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw 'OFFLINE_SOURCE_PARSE_FAILED'}
    $converter=@($offline.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-ManagedMcpApps'},$true))
    if($converter.Count -ne 1){throw 'OFFLINE_CONVERTER_MISSING'}
    Invoke-Expression $converter[0].Extent.Text
    function Mock-Pm2 { $global:LASTEXITCODE=0; '[{"name":"openchatx-mcp","pid":42,"pm2_env":{"status":"online"}}]' }
    $Node='Mock-Pm2';$pm2Cli='fixture-only'
    $apps=@(Get-ManagedMcpApps)
    if($apps.Count -ne 1 -or $apps[0].pm2_env.status -ne 'online' -or $apps[0].pid -ne 42){throw 'OFFLINE_PM2_JSON_COMPATIBILITY_FAILED'}
    function Mock-Pm2 { $global:LASTEXITCODE=3; '[]' }
    $blocked=$false
    try { Get-ManagedMcpApps | Out-Null } catch { $blocked=$true }
    if(-not $blocked){throw 'OFFLINE_PM2_ERROR_WAS_IGNORED'}
    Write-Output '[PASS] Actual offline updater PM2 parser supports PowerShell 5.1 and rejects native failures'
    $observerFixture=Join-Path $fixtureRoot 'observer-install'
    New-Item -ItemType Directory -Path $observerFixture|Out-Null
    $observerNames=@('runtime-readiness.ps1','audit-retention.mjs','audit-retention-policy.json','status-headless.ps1','Watch-OpenChatXHealth.ps1')
    foreach($name in $observerNames){[IO.File]::WriteAllText((Join-Path $observerFixture $name),'synthetic-old-observer')}
    $installer=Join-Path $sourceRoot 'runtime\Install-HealthObservers.ps1'
    $held=[IO.File]::Open((Join-Path $observerFixture 'audit-retention.mjs'),[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $previousErrorPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        $failure=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -HeadlessRoot $observerFixture 2>&1)
        $failedExit=$LASTEXITCODE
    } finally {$held.Dispose();$ErrorActionPreference=$previousErrorPreference}
    if($failedExit -eq 0){throw 'OBSERVER_FAILURE_INJECTION_DID_NOT_FAIL'}
    foreach($name in $observerNames){if([IO.File]::ReadAllText((Join-Path $observerFixture $name)) -ne 'synthetic-old-observer'){throw ('OBSERVER_ROLLBACK_FAILED: '+$name)}}
    $installed=@(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer -HeadlessRoot $observerFixture)
    if($LASTEXITCODE -ne 0 -or -not($installed -match 'OBSERVER_FILES_VERIFIED=5')){throw 'OBSERVER_ISOLATED_INSTALL_FAILED'}
    Write-Output '[PASS] Observer installer replaces isolated old files and rolls back a second-file sharing violation'
    Write-Output 'RUNTIME_HEALTH_VALIDATION_PASSED'
    $global:LASTEXITCODE=0
} finally {
    $resolved=[IO.Path]::GetFullPath($fixtureRoot)
    $expected=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\naos-health-fixture-'
    if(-not $resolved.StartsWith($expected,[StringComparison]::OrdinalIgnoreCase)){throw 'UNSAFE_HEALTH_FIXTURE_CLEANUP'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
