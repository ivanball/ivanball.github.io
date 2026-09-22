# adr-index.ps1 (Website copy: the one CI runs)
#
# Re-derive the ADR count and range from the ADR files themselves and check the
# index (docs-src/adr/README.md) against them. Deterministic: same input, same
# output, no model.
#
# This is the copy that runs in CI. The `adr-index` job in .github/workflows/ci.yml
# invokes it as `pwsh tools/adr-index.ps1 -Quiet` from the repository root on every
# push and pull request, so the ADR index cannot drift from the files in this repo
# without the build going red. The workspace also keeps a copy at
# Tools/Scripts/adr-index.ps1 for local use across repositories; that one defaults
# to this repository's ADR directory from outside it. The logic is the same in both;
# only the default -AdrDir differs. Keep them in step when either changes.
#
# WHY THIS EXISTS
# MMCA.Common/FACTS.md declares that adr/README.md owns the ADR count and range,
# but the README stated neither, so every consumer re-derived the range with an
# agent and had nothing authoritative to check against. A number nobody can check
# drifts silently: the ADC scorecard said 001-117 and the working notes said
# 001-122 while the directory held 001-123. This script makes the ownership claim
# true and machine-checked. Counting entries spread through a long document is
# aggregation, which is the first thing long-context inference gets wrong and the
# thing it gets wrong fluently, so it belongs here rather than in a prompt.
#
# Usage (from the repository root):
#   pwsh tools/adr-index.ps1            # check the index, human-readable
#   pwsh tools/adr-index.ps1 -Json      # machine-readable (count/range/problems)
#   pwsh tools/adr-index.ps1 -Quiet     # exit code only (what CI runs)
#
# Exit codes: 0 = index matches the files, 1 = mismatch, 2 = could not parse.

[CmdletBinding()]
param(
    [string]$AdrDir,
    [switch]$Json,
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Segment-wise Join-Path rather than a single '..\docs-src\adr' literal: CI runs
# this on ubuntu-latest, where a backslash is a filename character, not a separator.
if (-not $AdrDir) { $AdrDir = Join-Path $PSScriptRoot '..' 'docs-src' 'adr' }
if (-not (Test-Path -LiteralPath $AdrDir)) { Write-Error "ADR directory not found: $AdrDir"; exit 2 }
$AdrDir = (Resolve-Path -LiteralPath $AdrDir).Path
$readmePath = Join-Path $AdrDir 'README.md'
if (-not (Test-Path -LiteralPath $readmePath)) { Write-Error "ADR index not found: $readmePath"; exit 2 }

# --- Ground truth: the files on disk -----------------------------------------
$files = Get-ChildItem -LiteralPath $AdrDir -Filter '*.md' |
    Where-Object { $_.Name -match '^(\d{3})-' } |
    ForEach-Object { [pscustomobject]@{ Number = [int]$Matches[1]; Name = $_.Name } } |
    Sort-Object Number

if (-not $files) { Write-Error "No NNN-*.md ADR files found in $AdrDir"; exit 2 }

$numbers = @($files.Number)
$count = $numbers.Count
$min = $numbers[0]
$max = $numbers[-1]
$range = '{0:D3}-{1:D3}' -f $min, $max

$problems = @()

$dupes = $numbers | Group-Object | Where-Object Count -gt 1 | ForEach-Object { $_.Name }
if ($dupes) { $problems += "duplicate ADR numbers on disk: $($dupes -join ', ')" }

$gaps = @($min..$max | Where-Object { $_ -notin $numbers })
if ($gaps) { $problems += "gaps in the ADR numbering: $(($gaps | ForEach-Object { '{0:D3}' -f $_ }) -join ', ')" }

# --- The index table ----------------------------------------------------------
# A row is "| [NNN](NNN-slug.md) | Decision | Summary |". The summary column may
# itself contain pipes and brackets, so anchor on the leading link only.
$readmeLines = Get-Content -LiteralPath $readmePath
$rows = @()
foreach ($line in $readmeLines) {
    if ($line -match '^\|\s*\[(\d{3})\]\(([^)]+)\)\s*\|') {
        $rows += [pscustomobject]@{ Number = [int]$Matches[1]; Target = $Matches[2] }
    }
}
if (-not $rows) { $problems += 'no ADR rows parsed from the index table' }

$rowNumbers = @($rows.Number)
$rowDupes = $rowNumbers | Group-Object | Where-Object Count -gt 1 | ForEach-Object { $_.Name }
if ($rowDupes) { $problems += "duplicate rows in the index: $($rowDupes -join ', ')" }

$missingRows = @($numbers | Where-Object { $_ -notin $rowNumbers })
if ($missingRows) { $problems += "ADR files with no index row: $(($missingRows | ForEach-Object { '{0:D3}' -f $_ }) -join ', ')" }

$orphanRows = @($rowNumbers | Where-Object { $_ -notin $numbers })
if ($orphanRows) { $problems += "index rows with no ADR file: $(($orphanRows | ForEach-Object { '{0:D3}' -f $_ }) -join ', ')" }

# A row can point at the wrong file and still look right in the rendered page.
$byNumber = @{}
foreach ($f in $files) { $byNumber[$f.Number] = $f.Name }
foreach ($r in $rows) {
    if ($byNumber.ContainsKey($r.Number) -and $r.Target -ne $byNumber[$r.Number]) {
        $problems += ("row {0:D3} links to '{1}' but the file is '{2}'" -f $r.Number, $r.Target, $byNumber[$r.Number])
    }
}

# --- The stated count/range ---------------------------------------------------
# The index is the declared owner of these two numbers (MMCA.Common/FACTS.md), so
# it must state them and they must be right.
$readmeText = Get-Content -LiteralPath $readmePath -Raw
$statedCount = $null; $statedRange = $null

$m = [regex]::Match($readmeText, '(?m)^\s*\*\*(\d+)\s+accepted\s+ADRs\*\*,\s*(\d{3})-(\d{3})\b')
if ($m.Success) {
    $statedCount = [int]$m.Groups[1].Value
    $statedRange = '{0}-{1}' -f $m.Groups[2].Value, $m.Groups[3].Value
    if ($statedCount -ne $count) { $problems += "index states $statedCount ADRs, the directory holds $count" }
    if ($statedRange -ne $range) { $problems += "index states range $statedRange, the files give $range" }
}
else {
    $problems += "the index states no count/range line, but FACTS.md declares it owns both. Expected a line of the form: **$count accepted ADRs**, $range"
}

$result = [pscustomobject]@{
    Count       = $count
    Range       = $range
    StatedCount = $statedCount
    StatedRange = $statedRange
    IndexRows   = $rows.Count
    Problems    = $problems
    Ok          = ($problems.Count -eq 0)
}

if ($Json) {
    $result | ConvertTo-Json -Depth 4
}
elseif (-not $Quiet) {
    Write-Host ''
    Write-Host 'ADR index' -ForegroundColor Cyan
    Write-Host "  files on disk  $count ADRs, range $range"
    Write-Host "  index rows     $($rows.Count)"
    if ($result.Ok) {
        Write-Host '  OK: the index states the count and range, and both match the files' -ForegroundColor Green
    }
    else {
        Write-Host "  MISMATCH ($($problems.Count)):" -ForegroundColor Red
        $problems | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    }
    Write-Host ''
}

if (-not $result.Ok) { exit 1 }
exit 0
