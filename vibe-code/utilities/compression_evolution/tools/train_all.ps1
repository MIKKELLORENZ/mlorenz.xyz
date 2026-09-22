# train_all.ps1 — records the offline runs that champions.js is baked from.
#   powershell -NoProfile -File tools\train_all.ps1 [-Workers 5] [-Scale 1.0]
# First ONE design for all files; then a specialist per file, each starting from that
# generalist (exactly what the page does when you pick a single file).
# Logs and records land in training\ ; afterwards run  node bake_champions.js
# This machine is shared with other jobs: keep -Workers at 4-6.
param([int]$Workers = 5, [double]$Scale = 1.0, [switch]$ResumeAll)
Set-Location (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force training | Out-Null
function Note($t) { "[$(Get-Date -Format HH:mm:ss)] $t" | Out-File -Append -Encoding utf8 training\train_all.log }
$m = [math]::Round(35 * $Scale, 1)
Note "all for $m min"
if ($ResumeAll) { & node train_headless.js --data all --minutes $m --workers $Workers --seed 12 --resume *> training\all.log }
else { & node train_headless.js --data all --minutes $m --workers $Workers --seed 11 *> training\all.log }
foreach ($p in @(@('cat', 12), @('alice', 6), @('guitar', 8), @('meow', 4), @('code', 5))) {
    $m = [math]::Round($p[1] * $Scale, 1)
    Note "$($p[0]) for $m min, from the generalist"
    & node train_headless.js --data $p[0] --minutes $m --workers $Workers --seed 11 --from training\all.json *> "training\$($p[0]).log"
}
Note "done"
