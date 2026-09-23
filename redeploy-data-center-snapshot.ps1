$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = 'fandow-deploy@120.27.143.111'
$remote = '/tmp/live-center-module-deploy'
$tar = (Get-Command tar.exe -ErrorAction SilentlyContinue).Source
if (-not $tar) { throw 'Windows tar.exe is required.' }

$prepared = $false
for ($attempt = 1; $attempt -le 3 -and -not $prepared; $attempt++) {
  & ssh.exe -tt -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 $target "mkdir -p $remote"
  if ($LASTEXITCODE -eq 0) { $prepared = $true; break }
  if ($attempt -lt 3) { Write-Host "SSH preflight attempt $attempt failed; retrying in 5 seconds..." -ForegroundColor Yellow; Start-Sleep -Seconds 5 }
}
if (-not $prepared) { throw 'Preparing the server upload directory failed after 3 SSH attempts.' }
$archive = Join-Path $env:TEMP 'data-center-snapshot.tar.gz'
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
& $tar -czf $archive --exclude=node_modules --exclude=dist --exclude=.wrangler -C (Join-Path $root 'runtime') data-center
if ($LASTEXITCODE -ne 0) { throw 'Packaging data center failed.' }
& scp.exe -o StrictHostKeyChecking=accept-new $archive "$target`:$remote/data-center-snapshot.tar.gz"
& scp.exe -o StrictHostKeyChecking=accept-new (Join-Path $root 'redeploy-data-center-snapshot.sh') "$target`:$remote/redeploy-data-center-snapshot.sh"
if ($LASTEXITCODE -ne 0) { throw 'Uploading data center snapshot deployment failed.' }
& ssh.exe -tt -o StrictHostKeyChecking=accept-new $target "bash $remote/redeploy-data-center-snapshot.sh $remote/data-center-snapshot.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Data center snapshot deployment stopped; copy the terminal output back to Codex.' }
Write-Host 'Data center now serves the MCP-generated snapshot.'
