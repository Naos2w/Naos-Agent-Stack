[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProjectRoot,
    [Parameter(Mandatory=$true)][string]$NodeBinary,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference='Stop'
$ProjectRoot=[IO.Path]::GetFullPath($ProjectRoot)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $OutputDirectory){throw 'Measurement directory already exists'}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
$pipeline=Join-Path $ProjectRoot 'scripts/finance-brief-pipeline.mjs'
$sourceHash=(Get-FileHash -LiteralPath $pipeline -Algorithm SHA256).Hash
# Use the same public configuration inputs as existing offline contract tests.
$configFiles=@{
    MARKET_WATCHLIST_FROM_STOCK_PATH='watchlist-from-stock.json'; MARKET_WATCHLIST_FALLBACK_PATH='fallback-watchlist.json';
    MARKET_WATCHLIST_PATH='watchlist-from-stock.json'; TW_TICKER_REGISTRY_PATH='tw-ticker-registry.json';
    MARKET_OFFICIAL_SOURCES_PATH='official-sources.json'; US_COMPANY_SOURCES_PATH='us-company-sources.json';
    AUTHORITATIVE_SOURCE_DOMAINS_PATH='authoritative-source-domains.json'; STOCK_CONTEXT_PATH='stock-context.json';
    TW_PRICING_TRANSMISSION_MAP_PATH='tw-pricing-transmission-map.json'; US_MARKET_MAP_PATH='us-market-map.json';
    CROSS_MARKET_MAP_PATH='cross-market-map.json'; CATALYST_SIGNAL_POLICY_PATH='catalyst-signal-policy.json';
    TW_TRADING_CALENDAR='tw-trading-calendar.json'; US_TRADING_CALENDAR='us-trading-calendar.json'
}
$settings=@{OPENCLAW_SECRETS=(Join-Path $OutputDirectory 'absent.env'); MARKET_HISTORY_DB=(Join-Path $OutputDirectory 'unused.sqlite'); MARKET_CACHE_DIR=(Join-Path $OutputDirectory 'unused-cache'); SOURCE_SHORTENER_CACHE_PATH=(Join-Path $OutputDirectory 'unused-shortener.json')}
$configHashes=@{}
foreach($name in $configFiles.Keys){
    $path=Join-Path $ProjectRoot ('config/'+$configFiles[$name])
    $settings[$name]=$path
    if(Test-Path -LiteralPath $path){$configHashes[$configFiles[$name]]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}
}
$previous=@{}
$runs=@()
try {
    foreach($name in $settings.Keys){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$settings[$name],'Process')}
    for($i=1;$i -le 3;$i++){
        $stdout=Join-Path $OutputDirectory "run-$i.stdout.json"
        $stderr=Join-Path $OutputDirectory "run-$i.stderr.log"
        $timer=[Diagnostics.Stopwatch]::StartNew()
        $child=Start-Process -FilePath $NodeBinary -ArgumentList @('--max-old-space-size=256',('"'+$pipeline+'"'),'--market','tw','--dry-run','--self-test-industry-mapping') -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $peak=0L;$cpuMs=0.0
        while(-not $child.HasExited){
            $child.Refresh()
            try{$peak=[Math]::Max($peak,$child.PeakWorkingSet64);$cpuMs=$child.TotalProcessorTime.TotalMilliseconds}catch{}
            if($timer.Elapsed.TotalSeconds -gt 30){$child.Kill();throw 'Owned offline test exceeded thirty seconds'}
            Start-Sleep -Milliseconds 20
        }
        $child.WaitForExit();$timer.Stop()
        $cases=@(Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 | ConvertFrom-Json)
        $failed=@($cases | Where-Object {$_.ok -ne $true} | ForEach-Object {$_.name})
        $runs+= [ordered]@{wallMs=$timer.ElapsedMilliseconds;sampledCpuMs=$cpuMs;peakProcessWorkingSetBytes=$peak;exitCode=$child.ExitCode;cases=$cases.Count;failed=$failed}
    }
} finally {foreach($name in $previous.Keys){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
if((Get-FileHash -LiteralPath $pipeline -Algorithm SHA256).Hash -ne $sourceHash){throw 'Source changed during measurement'}
foreach($file in $configHashes.Keys){if((Get-FileHash -LiteralPath (Join-Path $ProjectRoot ('config/'+$file)) -Algorithm SHA256).Hash -ne $configHashes[$file]){throw 'Configuration changed during measurement'}}
$result=[ordered]@{schema=1;project='openclaw';source='scripts/finance-brief-pipeline.mjs';sourceSha256=$sourceHash;configSha256=$configHashes;command='node --max-old-space-size=256 scripts/finance-brief-pipeline.mjs --market tw --dry-run --self-test-industry-mapping';runs=$runs;memoryScope='One Node process; OS peak working set sampled every 20 ms, excludes subprocesses and other services';scope='Existing offline synthetic industry-mapping self-test only; not full regression or natural delivery';timestampUtc=[DateTime]::UtcNow.ToString('o')}
$json=$result|ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'measurement.json'),$json+"`n",[Text.UTF8Encoding]::new($false))
$json
if(@($runs|Where-Object {$_.exitCode -ne 0 -or $_.failed.Count -gt 0}).Count){throw 'Existing self-test has failures; preserve raw results'}
