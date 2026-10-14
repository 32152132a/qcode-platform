$ErrorActionPreference='Stop'
try{
    & (Join-Path $PSScriptRoot 'bootstrap.ps1') web
    if($LASTEXITCODE -ne 0){throw 'QCode 启动未完成，请运行 qcode doctor 检查。'}
}catch{
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message,'QCode 启动失败','OK','Error')|Out-Null
    exit 1
}
