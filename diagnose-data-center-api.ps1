$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "mkdir -p $remote"
if ($LASTEXITCODE -ne 0) { throw 'Preparing the server upload directory failed.' }
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'diagnose-data-center-api.sh') "$target`:$remote/diagnose-data-center-api.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the data diagnostic helper failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/diagnose-data-center-api.sh"
if ($LASTEXITCODE -ne 0) { throw 'Data-center API diagnostic stopped; copy the terminal output back to Codex.' }
