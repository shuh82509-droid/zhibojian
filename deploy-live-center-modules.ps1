$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sshTarget = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
$tar = (Get-Command tar.exe -ErrorAction SilentlyContinue).Source
if (-not $tar) { throw 'Windows tar.exe is required.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $sshTarget "mkdir -p $remote"
if ($LASTEXITCODE -ne 0) { throw 'Preparing the server upload directory failed.' }

foreach ($app in @('data-center','dispatch-center')) {
  $archive = Join-Path $env:TEMP "$app-live-center.tar.gz"
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  & $tar -czf $archive --exclude=node_modules --exclude=dist --exclude=.wrangler -C (Join-Path $root 'runtime') $app
  if ($LASTEXITCODE -ne 0) { throw "Packaging $app failed." }
  & scp.exe -o StrictHostKeyChecking=accept-new $archive "$sshTarget`:$remote/$app.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw "Uploading $app failed." }
}

& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'deploy-live-center-modules.sh') "$sshTarget`:$remote/deploy.sh"
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'provision-live-center-mcp-env.sh') "$sshTarget`:$remote/provision-env.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading the runtime configuration helper failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $sshTarget "bash $remote/provision-env.sh"
if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration setup stopped; copy the terminal output back to Codex.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $sshTarget "bash $remote/deploy.sh data-center $remote/data-center.tar.gz '直播数据指挥中心'"
if ($LASTEXITCODE -ne 0) { throw 'Data center deployment stopped; copy the terminal output back to Codex.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $sshTarget "bash $remote/deploy.sh dispatch-center $remote/dispatch-center.tar.gz '调度中心'"
if ($LASTEXITCODE -ne 0) { throw 'Dispatch center deployment stopped; copy the terminal output back to Codex.' }
Write-Host 'Both deployments passed their runtime checks.'
