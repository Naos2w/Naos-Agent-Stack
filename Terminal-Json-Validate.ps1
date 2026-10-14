# Validate a Windows Terminal JSONC settings file without modifying any settings.
# Executed by PowerShell 7+ for its System.Text.Json runtime.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
$opts=[System.Text.Json.JsonDocumentOptions]::new()
$opts.AllowTrailingCommas=$true
$opts.CommentHandling=[System.Text.Json.JsonCommentHandling]::Skip
$document=[System.Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8),$opts)
try{
    if($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object){
        throw 'Windows Terminal settings JSONC root is not an object.'
    }
    $default=[System.Text.Json.JsonElement]::new()
    if($document.RootElement.TryGetProperty('defaultProfile',[ref]$default)){
        if($default.ValueKind -ne [System.Text.Json.JsonValueKind]::String){throw 'Invalid defaultProfile property.'}
    }
}finally{$document.Dispose()}
exit 0
