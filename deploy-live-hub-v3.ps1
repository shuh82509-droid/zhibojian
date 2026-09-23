param([switch]$CandidateOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$remote = 'fandow-deploy@120.27.143.111'
$incoming = '/home/fandow-deploy/fandow-apps/incoming/fd-027340/live-hub-optimized'
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundle = Join-Path $env:TEMP "fd-027340-live-hub-v3-$stamp.tar.gz"
$dispatchBundle = Join-Path $env:TEMP "fd-027340-dispatch-v3-$stamp.tar.gz"
$remoteBundle = "$incoming/live-hub-v3-$stamp.tar.gz"
$remoteDispatchBundle = "$incoming/dispatch-v3-$stamp.tar.gz"
$remoteScript = "$incoming/deploy-live-hub-v3.sh"
$remoteDispatchScript = "$incoming/deploy-dispatch-parser-safe.sh"
$identityFile = Join-Path $env:USERPROFILE '.ssh\codex-fandow-deploy-ed25519'
$sshOptions = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'StrictHostKeyChecking=accept-new')
if (Test-Path -LiteralPath $identityFile) {
  $sshOptions += @('-i', $identityFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes')
}

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
  Write-Host '[1/5] Rebuilding and verifying every local module.' -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'runtime\collaboration-center')
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'The local collaboration build failed; nothing was uploaded.' }
  } finally {
    Pop-Location
  }
  Push-Location (Join-Path $projectRoot 'runtime\data-center')
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'The local business dashboard build failed; nothing was uploaded.' }
    & node --test 'tests/rendered-html.test.mjs' 'tests/audience-parser.test.mts' 'tests/mcp-resilience.test.mts'
    if ($LASTEXITCODE -ne 0) { throw 'The business dashboard parser tests failed; nothing was uploaded.' }
  } finally {
    Pop-Location
  }
  & node --test (Join-Path $projectRoot 'runtime\collaboration-center\tests\violation-parser.test.ts')
  if ($LASTEXITCODE -ne 0) { throw 'The strict violation parser tests failed; nothing was uploaded.' }
  & node --test (Join-Path $projectRoot 'runtime\dispatch-center\schedule-api-server.test.js') (Join-Path $projectRoot 'runtime\dispatch-center\single-level-shell.test.js') (Join-Path $projectRoot 'runtime\dispatch-center\planning-workbench.test.js')
  if ($LASTEXITCODE -ne 0) { throw 'The dispatch parser and monthly planning tests failed; nothing was uploaded.' }
  & node --test (Join-Path $projectRoot 'tests\lifecycle-engine.test.mjs') (Join-Path $projectRoot 'tests\ui-assets.test.mjs') (Join-Path $projectRoot 'tests\functional-upgrade.test.mjs') (Join-Path $projectRoot 'tests\evening-sep3.test.mjs') (Join-Path $projectRoot 'tests\sep7-live-center.test.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'The recruitment and anchor lifecycle tests failed; nothing was uploaded.' }
  $required = @(
    'lifecycle-engine.mjs',
    'runtime\data-center\dist\server\index.js',
    'runtime\collaboration-center\dist\server\index.js',
    'exports\recruitment-pool\recruitment-dashboard.html',
    'exports\anchor-archives\recruitment-dashboard.html',
    'exports\anchor-archives\assets\anchor-development.css',
    'exports\anchor-archives\assets\anchor-development-20260829.css',
    'exports\anchor-archives\assets\anchor-development.js',
    'exports\material-center\material-center.html',
    'exports\material-center\material-competitors.html',
    'exports\material-center\material-cue-cards.html',
    'exports\material-center\material-cue-cards-fixes.css',
    'exports\material-center\material-prohibited.html',
    'exports\material-center\material-scripts.html',
    'exports\material-center\communication-generator.html',
    'exports\material-center\communication-generator.css',
    'exports\material-center\communication-generator.js',
    'runtime\dispatch-center\Dockerfile',
    'runtime\dispatch-center\schedule-api-server.js',
    'runtime\dispatch-center\planning-engine.js',
    'runtime\dispatch-center\planning-workbench.css',
    'runtime\dispatch-center\planning-workbench-20260829.css',
    'runtime\dispatch-center\planning-workbench.js',
    'runtime\dispatch-center\live-status-shared.css'
  )
  foreach ($path in $required) { if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $path))) { throw "Missing local artifact: $path" } }
  & tar -czf $bundle Dockerfile.live-hub-v3-main Dockerfile.live-hub-v3-data server.js calendar-user-reader.mjs calendar-auth-http.mjs frame-policy.mjs lifecycle-engine.mjs container-entrypoint.sh site exports/recruitment-pool exports/anchor-archives exports/material-center runtime/collaboration-center/dist runtime/data-center/dist
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the V3 candidate failed.' }
  & tar -czf $dispatchBundle -C (Join-Path $projectRoot 'runtime') dispatch-center
  if ($LASTEXITCODE -ne 0) { throw 'Packaging the dispatch candidate failed.' }

  Write-Host '[2/5] Uploading the verified candidates with the configured deployment identity.' -ForegroundColor Yellow
  Invoke-TransportRetry -FailureMessage 'Preparing the scoped remote incoming directory failed after 3 attempts.' -Action { & ssh @sshOptions $remote "mkdir -p '$incoming'" }
  Invoke-TransportRetry -FailureMessage 'Uploading the V3 bundle failed after 3 attempts.' -Action { & scp @sshOptions $bundle "${remote}:$remoteBundle" }
  Invoke-TransportRetry -FailureMessage 'Uploading the dispatch bundle failed after 3 attempts.' -Action { & scp @sshOptions $dispatchBundle "${remote}:$remoteDispatchBundle" }
  Invoke-TransportRetry -FailureMessage 'Uploading the V3 deployment helper failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-live-hub-v3.sh') "${remote}:$remoteScript" }
  Invoke-TransportRetry -FailureMessage 'Uploading the dispatch deployment helper failed after 3 attempts.' -Action { & scp @sshOptions (Join-Path $projectRoot 'deploy-dispatch-parser-safe.sh') "${remote}:$remoteDispatchScript" }

  $dispatchDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time').ToString('yyyy-MM-dd')
  Write-Host "[3/5] Testing the newest $dispatchDate schedule block and all four rooms before switching dispatch production." -ForegroundColor Yellow
  $dispatchMode = if ($CandidateOnly) { 'candidate-only' } else { 'production' }
  $dispatchCommand = "chmod 700 '$remoteDispatchScript'; '$remoteDispatchScript' '$remoteDispatchBundle' '$dispatchDate' '0' '$dispatchDate' '$dispatchMode'"
  & ssh @sshOptions -tt $remote $dispatchCommand
  if ($LASTEXITCODE -ne 0) { throw 'Dispatch candidate verification or deployment stopped. Copy CANDIDATE_SCHEDULE/SOURCE_ROWS and the first error back to Codex.' }

  Write-Host '[4/5] Testing recruitment, anchors, business data, calendar, Coco, and violations before switching production.' -ForegroundColor Yellow
  $mainMode = if ($CandidateOnly) { 'candidate-only' } else { 'production' }
  $remoteCommand = "chmod 700 '$remoteScript'; '$remoteScript' '$remoteBundle' '$dispatchDate' '$mainMode'"
  & ssh @sshOptions -tt $remote $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'V3 candidate verification or deployment stopped. Copy the first CANDIDATE_* failure and logs back to Codex.' }

  if ($CandidateOnly) {
    Write-Host '[5/5] Candidate-only verification passed; production containers were not switched.' -ForegroundColor Green
  } else {
    Write-Host '[5/5] All dispatch, recruitment, anchor, business, calendar, and violation checks passed.' -ForegroundColor Green
  }
} finally {
  Pop-Location
  if (Test-Path -LiteralPath $bundle) { Remove-Item -LiteralPath $bundle -Force }
  if (Test-Path -LiteralPath $dispatchBundle) { Remove-Item -LiteralPath $dispatchBundle -Force }
}
