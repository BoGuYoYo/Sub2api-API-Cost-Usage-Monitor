# Recover local usage history from the app's WebView2 LevelDB.
#
# The old build overwrote its snapshot whenever the relay cleared its data, but
# every write is still in the LevelDB write-ahead log. This script walks the
# whole store, parses every snapshot blob it can find (v1/v2/v3 layouts) and
# keeps, per account and per field, the largest value ever observed.
#
# Output: a backup JSON that the app's "Restore" button accepts.
param(
  [string]$LevelDbPath = "$env:LOCALAPPDATA\com.apimonitor.app\EBWebView\Default\Local Storage\leveldb",
  [string]$OutFile = "$env:USERPROFILE\Downloads\API-Monitor-recovered-history.json",
  [switch]$DryRun,
  [switch]$ListBlobs
)

$ErrorActionPreference = "Stop"

function Get-Text {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  # Latin-1 keeps a 1:1 byte -> char mapping so UTF-16 blobs stay parseable
  # after their NUL bytes are stripped.
  return [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
}

function Get-JsonBlobs {
  param([string]$Text, [string]$Marker)
  $blobs = New-Object System.Collections.Generic.List[string]
  $search = 0
  while ($true) {
    $hit = $Text.IndexOf($Marker, $search)
    if ($hit -lt 0) { break }
    $start = $Text.IndexOf('{', $hit)
    if ($start -lt 0) { break }
    $depth = 0; $inString = $false; $escaped = $false; $end = -1
    for ($i = $start; $i -lt $Text.Length; $i++) {
      $ch = $Text[$i]
      if ([int]$ch -eq 0) { continue }
      if ($inString) {
        if ($escaped) { $escaped = $false }
        elseif ($ch -eq '\') { $escaped = $true }
        elseif ($ch -eq '"') { $inString = $false }
      } else {
        if ($ch -eq '"') { $inString = $true }
        elseif ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') {
          $depth--
          if ($depth -eq 0) { $end = $i; break }
        }
      }
    }
    if ($end -le $start) { break }
    $blobs.Add(($Text.Substring($start, $end - $start + 1) -replace "`0", ""))
    $search = $end
  }
  return $blobs
}

function Get-Num {
  param($Value)
  if ($null -eq $Value) { return 0 }
  $n = 0.0
  if ([double]::TryParse([string]$Value, [ref]$n)) { return $n }
  return 0
}

# ConvertFrom-Json turns ISO timestamps into [datetime]; keep them as such so
# "newer than" comparisons are real time comparisons, and re-emit ISO on export.
function Get-Time {
  param($Value)
  if ($null -eq $Value) { return [datetime]::MinValue }
  if ($Value -is [datetime]) { return $Value }
  $parsed = [datetime]::MinValue
  if ([datetime]::TryParse([string]$Value, [ref]$parsed)) { return $parsed }
  return [datetime]::MinValue
}

function Format-Time {
  param([datetime]$Value)
  if ($Value -eq [datetime]::MinValue) { return "1970-01-01T00:00:00.000Z" }
  return $Value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

function Merge-Day {
  param($Target, $Date, $Day)
  if ($null -eq $Day) { return }
  $current = $Target[$Date]
  $incoming = @{
    date         = $Date
    requests     = Get-Num $Day.requests
    inputTokens  = Get-Num $Day.inputTokens
    outputTokens = Get-Num $Day.outputTokens
    totalTokens  = Get-Num $Day.totalTokens
    cost         = Get-Num $Day.cost
  }
  if ($null -eq $current) { $Target[$Date] = $incoming; return }
  foreach ($field in @("requests", "inputTokens", "outputTokens", "totalTokens", "cost")) {
    if ($incoming[$field] -gt $current[$field]) { $current[$field] = $incoming[$field] }
  }
}

$files = Get-ChildItem $LevelDbPath -File | Where-Object { $_.Extension -in @(".log", ".ldb") }
$accounts = @{}
$blobCount = 0
$parsedCount = 0

foreach ($file in $files) {
  $text = Get-Text -Path $file.FullName
  foreach ($marker in @("sub2api_usage_snapshots_v3", "sub2api_usage_snapshots_v2", "sub2api_usage_snapshots_v1")) {
    foreach ($blob in (Get-JsonBlobs -Text $text -Marker $marker)) {
      $blobCount++
      try {
        $parsed = $blob | ConvertFrom-Json
      } catch {
        if ($ListBlobs) { Write-Output "FAILED  $($file.Name) $marker len=$($blob.Length) :: $($blob.Substring(0, [Math]::Min(90, $blob.Length)))" }
        continue
      }
      $parsedCount++
      if ($ListBlobs) {
        $names = ($parsed.PSObject.Properties | ForEach-Object {
            $sync = Format-Time (Get-Time $_.Value.lastSyncAt)
            "$($_.Name.ToString().Substring(0,8)):cum=$($_.Value.cumulative.totalTokens) local=$($_.Value.local.totalTokens) sync=$sync"
          }) -join " | "
        Write-Output "OK      $($file.Name) $marker len=$($blob.Length) :: $names"
      }
      foreach ($prop in $parsed.PSObject.Properties) {
        $accountId = $prop.Name
        $entry = $prop.Value
        if ($null -eq $entry) { continue }

        # v3 keeps the accumulated totals in `local`; v1/v2 only ever had the
        # relay's reading, which was the best available number at the time.
        $candidates = New-Object System.Collections.Generic.List[object]
        if ($null -ne $entry.local) { $candidates.Add($entry.local) }
        if ($null -ne $entry.cumulative) { $candidates.Add($entry.cumulative) }

        foreach ($candidate in $candidates) {
          $tokens = Get-Num $candidate.totalTokens
          $requests = Get-Num $candidate.totalRequests
          $cost = Get-Num $candidate.totalCost
          if (-not $accounts.ContainsKey($accountId)) {
            $accounts[$accountId] = @{
              local      = @{ totalTokens = 0.0; totalRequests = 0.0; totalCost = 0.0 }
              newest     = @{ totalTokens = 0.0; totalRequests = 0.0; totalCost = 0.0 }
              observedAt = [datetime]::MinValue
              lastSyncAt = [datetime]::MinValue
              days       = @{}
            }
          }
          $record = $accounts[$accountId]
          if ($tokens -gt $record.local.totalTokens) { $record.local.totalTokens = $tokens }
          if ($requests -gt $record.local.totalRequests) { $record.local.totalRequests = $requests }
          if ($cost -gt $record.local.totalCost) { $record.local.totalCost = $cost }
        }

        $lastSync = Get-Time $entry.lastSyncAt
        if ($lastSync -gt $accounts[$accountId].lastSyncAt) { $accounts[$accountId].lastSyncAt = $lastSync }

        # Remember the relay reading of the newest observation: that is the value
        # the app must diff against, never the historical peak.
        if ($null -ne $entry.cumulative -and $lastSync -ge $accounts[$accountId].observedAt) {
          $reading = $entry.cumulative
          $accounts[$accountId].observedAt = $lastSync
          $accounts[$accountId].newest = @{
            totalTokens   = (Get-Num $reading.totalTokens)
            totalRequests = (Get-Num $reading.totalRequests)
            totalCost     = (Get-Num $reading.totalCost)
          }
        }

        if ($null -ne $entry.days) {
          foreach ($dayProp in $entry.days.PSObject.Properties) {
            Merge-Day -Target $accounts[$accountId].days -Date $dayProp.Name -Day $dayProp.Value
          }
        }
      }
    }
  }
}

Write-Output "leveldb files scanned : $($files.Count)"
Write-Output "snapshot blobs found  : $blobCount"
Write-Output "blobs parsed as JSON  : $parsedCount"
Write-Output "accounts recovered    : $($accounts.Count)"
Write-Output ""
$rows = foreach ($key in $accounts.Keys) {
  [pscustomobject]@{
    account     = $key
    localTokens = [math]::Round($accounts[$key].local.totalTokens)
    relayNow    = [math]::Round($accounts[$key].newest.totalTokens)
    recovered   = [math]::Round($accounts[$key].local.totalTokens - $accounts[$key].newest.totalTokens)
    requests    = [math]::Round($accounts[$key].local.totalRequests)
    cost        = [math]::Round($accounts[$key].local.totalCost, 4)
    days        = $accounts[$key].days.Count
  }
}
$rows | Sort-Object -Property recovered -Descending | Format-Table -AutoSize

if ($DryRun) { return }

$snapshots = @{}
foreach ($key in $accounts.Keys) {
  $record = $accounts[$key]
  $lostBefore = $record.local.totalTokens -gt $record.newest.totalTokens
  $snapshots[$key] = @{
    accountId  = $key
    lastSyncAt = (Format-Time $record.lastSyncAt)
    local      = @{
      totalTokens = $record.local.totalTokens; totalRequests = $record.local.totalRequests; totalCost = $record.local.totalCost
      todayTokens = 0; todayRequests = 0; todayCost = 0
    }
    cumulative = @{
      totalTokens = $record.newest.totalTokens; totalRequests = $record.newest.totalRequests; totalCost = $record.newest.totalCost
      todayTokens = 0; todayRequests = 0; todayCost = 0
    }
    seeded     = $true
    resetCount = if ($lostBefore) { 1 } else { 0 }
    lastReset  = if ($lostBefore) {
      @{
        detectedAt       = (Format-Time $record.observedAt)
        previousTokens   = $record.local.totalTokens
        previousRequests = $record.local.totalRequests
        previousCost     = $record.local.totalCost
        reportedTokens   = $record.newest.totalTokens
        reportedRequests = $record.newest.totalRequests
        reportedCost     = $record.newest.totalCost
        count            = 1
      }
    } else { $null }
    days       = $record.days
  }
}

$backup = @{
  app        = "sub2api-api-cost-usage-monitor"
  version    = 2
  exportedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  deviceKey  = $null
  accounts   = @()
  snapshots  = $snapshots
}

$json = $backup | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output ""
Write-Output "recovered backup written to: $OutFile ($([math]::Round((Get-Item $OutFile).Length/1KB,1)) KB)"
