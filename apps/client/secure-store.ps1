param([Parameter(Mandatory=$true)][ValidateSet('read','write')][string]$Action,[Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
function Reveal($secure) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($Action -eq 'read') {
    $saved = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($saved.protectedSession) { [Console]::Out.Write((Reveal (ConvertTo-SecureString $saved.protectedSession))) }
    else {
        $token = Reveal (ConvertTo-SecureString $saved.protectedToken)
        $refresh = if ($saved.protectedRefresh) { Reveal (ConvertTo-SecureString $saved.protectedRefresh) } else { $null }
        [Console]::Out.Write((@{token=$token;refreshToken=$refresh;expiresAt=$saved.expiresAt;user=@{id=$saved.userId;username=$saved.username}} | ConvertTo-Json -Depth 10 -Compress))
    }
} else {
    $plain = [Console]::In.ReadToEnd()
    $session = $plain | ConvertFrom-Json
    if (-not $session.token -or -not $session.user.id) { throw 'Invalid session format' }
    $protected = ConvertFrom-SecureString (ConvertTo-SecureString $plain -AsPlainText -Force)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        [IO.File]::WriteAllText($temporary, (@{protectedSession=$protected;userId=$session.user.id;username=$session.user.username;expiresAt=$session.expiresAt} | ConvertTo-Json), $utf8)
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $null) } else { [IO.File]::Move($temporary, $Path) }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }; $plain=$null }
}
