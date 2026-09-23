$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$remote='fandow-deploy@120.27.143.111'
$target="/tmp/fd-027340-schedule-exact-$([Guid]::NewGuid().ToString('N')).py"
$opts=@('-o','ConnectTimeout=30','-o','ConnectionAttempts=3','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-o','StrictHostKeyChecking=accept-new')
for($attempt=1;$attempt -le 3;$attempt++){
  & scp @opts (Join-Path $root 'inspect-schedule-exact.py') "${remote}:$target"
  if($LASTEXITCODE -eq 0){break}
  if($attempt -eq 3){throw 'Upload failed after 3 attempts.'}
  Write-Host "SSH transport interrupted. Retrying ($($attempt+1)/3)..." -ForegroundColor Yellow
}
& ssh @opts -tt $remote "set -a; . /home/fandow-deploy/fandow-apps/runtime/fd-027340/live-center-workbench/.env.coco; set +a; python3 '$target'"
if($LASTEXITCODE -ne 0){throw 'Exact schedule inspection failed.'}
