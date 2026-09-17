param(
  [string]$Repo,
  [string]$OutPrefix
)

function Run([string]$cmd, [string]$outFile) {
  $lines = & cmd.exe /d /c "cd /d `"$Repo`" && $cmd" 2>&1
  [System.IO.File]::WriteAllLines($outFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
  return $lines.Count
}

$n1 = Run 'git rev-parse HEAD && git log -1 --format=%H%n%ci%n%s' "$OutPrefix-head.txt"
$n2 = Run 'git ls-files' "$OutPrefix-tracked.txt"
$n3 = Run 'git status --porcelain' "$OutPrefix-status.txt"
$n4 = Run 'git log --oneline -40' "$OutPrefix-log40.txt"
$n5 = Run 'git ls-files --others --exclude-standard' "$OutPrefix-untracked.txt"

Write-Output "$OutPrefix head=$n1 tracked=$n2 status=$n3 log40=$n4 untracked=$n5"
