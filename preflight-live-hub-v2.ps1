$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$remoteScript = "/tmp/fd-027340-live-hub-v2-preflight-$([Guid]::NewGuid().ToString('N')).sh"
$sshOptions = @('-o','ConnectTimeout=30','-o','ConnectionAttempts=3','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-o','StrictHostKeyChecking=accept-new')

function Invoke-UploadRetry {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$FailureMessage,
    [int]$Attempts = 3
  )
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

Write-Host '[1/2] Uploading the read-only V2 preflight to the existing server temp directory. Enter the SSH password.' -ForegroundColor Yellow
Invoke-UploadRetry -FailureMessage 'Uploading the preflight failed after 3 transport attempts.' -Action {
  & scp @sshOptions (Join-Path $projectRoot 'preflight-live-hub-v2.sh') "${remote}:$remoteScript"
}

Write-Host '[2/2] Checking every critical source before deployment. Enter the SSH password.' -ForegroundColor Yellow
for ($attempt = 1; $attempt -le 3; $attempt++) {
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript'"
  $exitCode = $LASTEXITCODE
  if ($exitCode -eq 0) { break }
  if ($exitCode -ne 255) {
    throw 'V2 preflight found a data or permission blocker. Copy all SOURCE_FAIL/PREFLIGHT_BLOCKED lines back to Codex.'
  }
  if ($attempt -lt 3) {
    Write-Host "SSH transport was interrupted. Retrying execution ($($attempt + 1)/3)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
  } else {
    throw 'SSH transport was interrupted 3 times during the preflight.'
  }
}
Write-Host 'All critical checks passed. Deployment has NOT started yet.' -ForegroundColor Green
