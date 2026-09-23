$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundle = Join-Path $env:TEMP "fd-027340-collaboration-violations-$stamp.tar.gz"
$remoteBundle = "$incoming/collaboration-violations-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-collaboration-violations.sh"
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-TransportRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action,[Parameter(Mandatory = $true)][string]$FailureMessage,[int]$Attempts = 3)
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    & $Action
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $Attempts) {
      Write-Host "SSH transport was interrupted. Retrying ($($attempt + 1)/$Attempts)..." -ForegroundColor Yellow
      Start-Sleep -Seconds 2
    }
  }
  throw $FailureMessage
}

Push-Location $projectRoot
try {
  Write-Host '[1/4] Rebuilding the collaboration module locally.' -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'runtime\collaboration-center')
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Local collaboration build failed.' }
  } finally { Pop-Location }

  & tar -czf $bundle Dockerfile.collaboration-hotfix runtime/collaboration-center/dist
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the collaboration update failed.' }

  Write-Host '[2/4] Uploading the verified collaboration build. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading the collaboration bundle failed after 3 attempts.' -Action { & scp @sshOptions $bundle "${remote}:$remoteBundle" }
  Invoke-TransportRetry -FailureMessage 'Uploading the deployment helper failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-collaboration-violations.sh') "${remote}:$remoteScript" }

  Write-Host '[3/4] Testing a candidate container against the Coco violation chat. Enter SSH/sudo passwords when prompted.' -ForegroundColor Yellow
  $remoteCommand = "chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle'"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'Collaboration deployment stopped before or during verification. Copy the terminal output back to Codex.' }

  Write-Host '[4/4] Deployment and live-data verification completed.' -ForegroundColor Green
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
