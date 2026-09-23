$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundle = Join-Path $env:TEMP "fd-027340-recruitment-resume-trend-$stamp.tar.gz"
$remoteBundle = "$incoming/recruitment-resume-trend-$stamp.tar.gz"
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
  Write-Host '[1/3] Verifying and packaging only the recruitment page.' -ForegroundColor Yellow
  $htmlPath = Join-Path $projectRoot 'exports\recruitment-pool\recruitment-dashboard.html'
  $html = Get-Content -LiteralPath $htmlPath -Raw
  $required = @('function resumeSubmissionName(text)','liveResumeCounts===null','const submissionKey=`${date}|${name}`')
  foreach ($item in $required) { if (-not $html.Contains($item)) { throw "Missing local recruitment rule: $item" } }
  if (-not (Select-String -LiteralPath (Join-Path $projectRoot 'server.js') -SimpleMatch "params.set('start_time'") ) { throw 'Missing recruitment time-window pagination in server.js.' }
  & tar -czf $bundle Dockerfile.recruitment-resume-trend server.js calendar-user-reader.mjs calendar-auth-http.mjs frame-policy.mjs lifecycle-engine.mjs exports/recruitment-pool/recruitment-dashboard.html
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the recruitment overlay failed.' }

  Write-Host '[2/3] Uploading the recruitment overlay. Enter the SSH password.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Uploading the recruitment bundle failed after 3 attempts.' -Action { & scp @sshOptions $bundle "${remote}:$remoteBundle" }
  Invoke-TransportRetry -FailureMessage 'Uploading the recruitment deployment helper failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-recruitment-resume-trend.sh') "${remote}:$remoteScript" }

  $targetDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd')
  Write-Host '[3/3] Testing the page and live recruitment chat before switching production.' -ForegroundColor Yellow
  & ssh @sshOptions -tt $remote "chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle' '$targetDate'"
  if ($LASTEXITCODE -ne 0) { throw 'Recruitment deployment stopped before production verification. Copy the first CANDIDATE_* error back to Codex.' }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
}
