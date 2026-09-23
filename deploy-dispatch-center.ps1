$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
$tar = (Get-Command tar.exe -ErrorAction SilentlyContinue).Source
if (-not $tar) { throw 'Windows tar.exe is required.' }

& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "mkdir -p $remote"
if ($LASTEXITCODE -ne 0) { throw 'Preparing the server upload directory failed.' }

$archive = Join-Path $env:TEMP 'dispatch-center-live-center.tar.gz'
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
& $tar -czf $archive --exclude=node_modules --exclude=dist --exclude=.wrangler -C (Join-Path $root 'runtime') dispatch-center
if ($LASTEXITCODE -ne 0) { throw 'Packaging dispatch center failed.' }

& scp.exe -o StrictHostKeyChecking=accept-new $archive "$target`:$remote/dispatch-center.tar.gz"
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'deploy-live-center-modules.sh') "$target`:$remote/deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading dispatch center failed.' }

& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/deploy.sh dispatch-center $remote/dispatch-center.tar.gz dispatch-center"
if ($LASTEXITCODE -ne 0) { throw 'Dispatch center deployment stopped; copy the terminal output back to Codex.' }
Write-Host 'Dispatch center deployment passed its runtime check.'
