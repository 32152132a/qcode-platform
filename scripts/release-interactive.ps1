[CmdletBinding()]
param([switch]$PublishExisting)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$previousPath=$env:PATH
try{
    $candidates=@($env:QCODE_NODE)
    $installed=Get-Command node -ErrorAction SilentlyContinue
    if($installed){$candidates+=$installed.Source}
    $candidates+=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    $node=$null
    foreach($candidate in $candidates){
        if(-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
        $version=& $candidate --version
        if($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24){$node=$candidate;break}
    }
    if(-not $node){throw 'Install Node.js 24 or newer, or set QCODE_NODE to node.exe.'}
    $env:PATH=(Split-Path $node -Parent)+';'+$env:PATH
    $releaseScript=Join-Path $PSScriptRoot 'release-client.ps1'
    if($PublishExisting){
        Add-Type -AssemblyName System.Windows.Forms
        $picker=New-Object System.Windows.Forms.FolderBrowserDialog
        try{
            $picker.Description='Select the release folder containing manifest.json, EXE and ZIP'
            $picker.SelectedPath=Join-Path $root 'artifacts'
            $picker.ShowNewFolderButton=$false
            if($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){Write-Host 'Cancelled. No release uploaded.';exit 0}
            $release=$picker.SelectedPath
        }finally{$picker.Dispose()}
        & $releaseScript -PublishDirectory $release
    }else{
        Write-Host 'Build, test and publish QCode to the configured server.'
        Write-Host 'For a new release, update apps/client/release.json before running this command.'
        & $releaseScript
    }
    Write-Host 'QCode release completed.' -ForegroundColor Green
}catch{
    Write-Host ('Release stopped: '+$_.Exception.Message) -ForegroundColor Red
    Write-Host 'Existing downloads remain active unless publication already succeeded.'
    exit 1
}finally{$env:PATH=$previousPath}
