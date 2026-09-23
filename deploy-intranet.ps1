# Run this file in a visible PowerShell window. It prompts for the SSH password
# and the server may prompt once more for sudo. Neither password is stored here.
$ErrorActionPreference = 'Stop'
$deployRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleName = "live-center-workbench-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmss')).tar.gz"
$bundlePath = Join-Path $env:TEMP $bundleName
$remote = 'fandow-deploy@120.27.143.111'
$remoteDir = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench'

Push-Location $deployRoot
try {
  & tar -czf $bundlePath --exclude=.git --exclude=.agents --exclude=.codex --exclude=sources --exclude=node_modules .
  if ($LASTEXITCODE -ne 0) { throw 'Local packaging failed.' }
  Write-Host 'Preparing the server directory. Enter the SSH password at the prompt.' -ForegroundColor Yellow
  & ssh $remote "mkdir -p '$remoteDir'"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create the remote deployment directory.' }
  Write-Host 'Uploading. Enter the SSH password again at the prompt.' -ForegroundColor Yellow
  & scp $bundlePath "${remote}:$remoteDir/$bundleName"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
  Write-Host 'Deploying. Enter SSH and sudo passwords if prompted.' -ForegroundColor Yellow
  & ssh $remote "mkdir -p '$remoteDir' && cd '$remoteDir' && tar -xzf '$bundleName' && rm -f '$bundleName' && chmod +x deploy-remote.sh && ./deploy-remote.sh"
  if ($LASTEXITCODE -ne 0) { throw 'Deployment command failed. Keep the error shown in this window.' }
  Write-Host 'Deployment complete. You may close this window.' -ForegroundColor Green
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundlePath) { Remove-Item -LiteralPath $bundlePath -Force }
}
