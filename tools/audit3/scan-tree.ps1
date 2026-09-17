param(
  [string]$Root,
  [string]$Out,
  [string]$Label
)

$skipDirs = @('node_modules', '.git', 'logs', 'output', 'release', 'dist', '.impeccable', '.codex-tmp', 'playwright-report', 'test-results', 'coverage')

$all = New-Object System.Collections.Generic.List[object]
$stack = New-Object System.Collections.Generic.Stack[string]
$stack.Push($Root)

while ($stack.Count -gt 0) {
  $dir = $stack.Pop()
  $entries = $null
  try { $entries = [System.IO.Directory]::GetFileSystemEntries($dir) } catch { continue }
  foreach ($e in $entries) {
    $name = [System.IO.Path]::GetFileName($e)
    if ([System.IO.Directory]::Exists($e)) {
      if ($skipDirs -contains $name) { continue }
      $stack.Push($e)
    } else {
      $fi = New-Object System.IO.FileInfo($e)
      $rel = $e.Substring($Root.Length).TrimStart('\')
      $all.Add([pscustomobject]@{ Rel = $rel; Size = $fi.Length })
    }
  }
}

$all = $all | Sort-Object Rel
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# TREE $Label  root=$Root")
$lines.Add("# FILES=$($all.Count)")
foreach ($f in $all) { $lines.Add(("{0,9}  {1}" -f $f.Size, $f.Rel)) }
[System.IO.File]::WriteAllLines($Out, $lines, (New-Object System.Text.UTF8Encoding($false)))

# directory summary
$dirs = @{}
foreach ($f in $all) {
  $d = [System.IO.Path]::GetDirectoryName($f.Rel)
  if ([string]::IsNullOrEmpty($d)) { $d = '.' }
  if ($dirs.ContainsKey($d)) { $dirs[$d]++ } else { $dirs[$d] = 1 }
}
$sum = New-Object System.Collections.Generic.List[string]
$sum.Add("# DIRCOUNT $Label")
foreach ($k in ($dirs.Keys | Sort-Object)) { $sum.Add(("{0,6}  {1}" -f $dirs[$k], $k)) }
[System.IO.File]::WriteAllLines(($Out -replace '\.txt$', '-dirs.txt'), $sum, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "$Label files=$($all.Count) dirs=$($dirs.Count)"
