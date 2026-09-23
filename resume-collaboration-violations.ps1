$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$remoteScript = "$incoming/resume-collaboration-violations.sh"
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

Write-Host '[1/2] Uploading the startup-race-safe resume helper. Enter the SSH password.' -ForegroundColor Yellow
Invoke-TransportRetry -FailureMessage 'Uploading the resume helper failed after 3 attempts.' -Action {
  & scp @sshOptions (Join-Path $projectRoot 'resume-collaboration-violations.sh') "${remote}:$remoteScript"
}

Write-Host '[2/2] Waiting for both services, verifying Coco data, and switching production. Enter the SSH password.' -ForegroundColor Yellow
& ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript'"
if ($LASTEXITCODE -ne 0) { throw 'Collaboration deployment resume failed; copy the terminal output back to Codex.' }
