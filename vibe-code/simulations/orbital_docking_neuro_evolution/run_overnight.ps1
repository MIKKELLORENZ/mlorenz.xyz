# Launches the trainer and stops it at a wall-clock deadline (default 07:00).
# Node has no notion of "train until morning"; this wrapper does, and it kills
# the whole worker pool rather than leaving five orphaned threads behind.
param([string]$Until = "07:00", [int]$Workers = 5, [int]$Pop = 128, [int]$Seed = 71)

$now  = Get-Date
$stop = [datetime]::ParseExact($Until, "HH:mm", $null)
if ($stop -le $now) { $stop = $stop.AddDays(1) }
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$log = Join-Path $env:TEMP "dock_overnight.log"
$err = Join-Path $env:TEMP "dock_overnight.err"
Write-Output "training until $stop  ($([math]::Round(($stop-$now).TotalHours,2)) h)  log: $log"

$p = Start-Process -FilePath "node" -PassThru -WindowStyle Hidden `
     -ArgumentList "train.js","--gens","1000000","--pop","$Pop","--bank","6", `
                   "--workers","$Workers","--every","5","--seed","$Seed" `
     -RedirectStandardOutput $log -RedirectStandardError $err

while ((Get-Date) -lt $stop -and -not $p.HasExited) { Start-Sleep -Seconds 30 }
if (-not $p.HasExited) {
    # /T so the worker threads go with it.
    & taskkill /F /T /PID $p.Id | Out-Null
    Write-Output "stopped at $(Get-Date)"
}
Write-Output (Get-Content $log -Tail 3)
