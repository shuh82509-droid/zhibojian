$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$remoteBundle = "$incoming/recruitment-resume-trend-20260819125717.tar.gz"
$remoteScript = "$incoming/deploy-recruitment-resume-trend.sh"
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
  Write-Host '[1/2] Uploading the corrected candidate verifier. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading the corrected verifier failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-recruitment-resume-trend.sh') "${remote}:$remoteScript" }
  $targetDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd')
  Write-Host '[2/2] Reusing the existing recruitment bundle and verifying before production switch.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "test -s '$remoteBundle'; chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle' '$targetDate'"
  if ($LASTEXITCODE -ne 0) { throw 'Recruitment resume stopped before production verification. Copy the first CANDIDATE_* error back to Codex.' }
} finally {
  Pop-Location
}
