$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$remoteDiagnostic = "$incoming/diagnose-collaboration-violations.py"
$envFile = '/home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/.env.coco'
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

Write-Host '[1/2] Uploading the read-only Coco violation diagnostic. Enter the SSH password.' -ForegroundColor Yellow
Invoke-TransportRetry -FailureMessage 'Uploading the violation diagnostic failed after 3 attempts.' -Action {
  & scp @sshOptions (Join-Path $projectRoot 'diagnose-collaboration-violations.py') "${remote}:$remoteDiagnostic"
}

Write-Host '[2/2] Checking the exact violation chat and current live endpoint. Enter the SSH password.' -ForegroundColor Yellow
Invoke-TransportRetry -FailureMessage 'Violation diagnostic failed, or SSH was interrupted 3 times.' -Action {
  & ssh @sshOptions -tt $remote "python3 '$remoteDiagnostic' '$envFile'"
}
