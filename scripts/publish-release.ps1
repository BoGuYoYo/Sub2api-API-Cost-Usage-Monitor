# Publish the built installers as a GitHub release.
#
#   pwsh -File scripts\publish-release.ps1 -NotesFile release-notes.md
#
# Run `npm run tauri build` first. The version is read from tauri.conf.json, and
# auth comes from the credential git already uses for github.com (the token is
# read from `git credential fill` and never printed). Existing releases and
# assets are detected, so re-running only uploads what is missing.
param(
  [string]$NotesFile = "",
  [string]$Tag = "",
  [string]$Title = "",
  [switch]$Draft
)

$ErrorActionPreference = "Stop"
$env:GIT_TERMINAL_PROMPT = "0"

$repoRoot = Split-Path $PSScriptRoot -Parent
$conf = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$product = $conf.productName -replace "\s", ""
$version = $conf.version
if (-not $Tag) { $Tag = "v$version" }
if (-not $Title) { $Title = "$($conf.productName) $version" }

$remote = (git -C $repoRoot remote get-url origin) -replace ".*github\.com[:/]", "" -replace "\.git$", ""
$Owner, $RepoName = $remote.Split("/")
Write-Output "repository: $Owner/$RepoName   tag: $Tag"

$buildDir = Join-Path $repoRoot "src-tauri\target\release"
$stageDir = Join-Path $env:TEMP "api-monitor-release-$version"

$credential = "protocol=https`nhost=github.com`n`n" | git credential fill
$token = (($credential -split "`n" | Where-Object { $_ -like "password=*" }) -replace "^password=", "").Trim()
if (-not $token) { throw "No GitHub credential found for github.com." }

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = "application/vnd.github+json"
  "User-Agent"           = "api-monitor-release"
  "X-GitHub-Api-Version" = "2022-11-28"
}
$api = "https://api.github.com/repos/$Owner/$RepoName"

$who = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
Write-Output "authenticated as: $($who.login)"

# ---------------------------------------------------------------- stage assets
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
$assets = @()

function Stage-Asset {
  param([string]$Source, [string]$Name)
  if (-not (Test-Path $Source)) { throw "missing build output: $Source" }
  $target = Join-Path $stageDir $Name
  Copy-Item $Source $target -Force
  return $target
}

$assets += Stage-Asset (Join-Path $buildDir "bundle\nsis\$($conf.productName)_${version}_x64-setup.exe") "API-Monitor-$version-x64-setup.exe"
$assets += Stage-Asset (Join-Path $buildDir "bundle\msi\$($conf.productName)_${version}_x64_en-US.msi") "API-Monitor-$version-x64.msi"

# Portable build: the bare executable in a zip.
$portableDir = Join-Path $stageDir "portable"
New-Item -ItemType Directory -Force -Path $portableDir | Out-Null
$portableExe = Join-Path $portableDir "$($conf.productName).exe"
Copy-Item (Join-Path $buildDir "app.exe") $portableExe -Force
$zip = Join-Path $stageDir "API-Monitor-$version-portable-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $portableExe -DestinationPath $zip -CompressionLevel Optimal
$assets += $zip

foreach ($asset in $assets) {
  Write-Output ("  {0,-38} {1,8:N2} MB" -f (Split-Path $asset -Leaf), ((Get-Item $asset).Length / 1MB))
}

# ------------------------------------------------------------- create release
$body = ""
if ($NotesFile) {
  $notesPath = if (Test-Path $NotesFile) { $NotesFile } else { Join-Path $repoRoot $NotesFile }
  if (Test-Path $notesPath) { $body = Get-Content $notesPath -Raw } else { Write-Warning "notes file not found: $NotesFile" }
}

$release = $null
try {
  $release = Invoke-RestMethod -Uri "$api/releases/tags/$Tag" -Headers $headers -Method Get
  Write-Output "release $Tag already exists (id $($release.id))"
} catch {
  Write-Output "creating release $Tag ..."
  $payload = @{
    tag_name         = $Tag
    target_commitish = "main"
    name             = $Title
    body             = $body
    draft            = [bool]$Draft
    prerelease       = $false
  } | ConvertTo-Json -Depth 4
  $release = Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Post -Body $payload -ContentType "application/json"
}
Write-Output "release: $($release.html_url)"

# -------------------------------------------------------------- upload assets
$existing = @()
try {
  $existing = (Invoke-RestMethod -Uri "$api/releases/$($release.id)/assets" -Headers $headers -Method Get | ForEach-Object { $_.name })
} catch { }

foreach ($asset in $assets) {
  $name = Split-Path $asset -Leaf
  if ($existing -contains $name) {
    Write-Output "  skip   $name (already uploaded)"
    continue
  }
  $uploadUrl = "https://uploads.github.com/repos/$Owner/$RepoName/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($name))"
  $response = Invoke-RestMethod -Uri $uploadUrl -Headers $headers -Method Post -InFile $asset -ContentType "application/octet-stream"
  Write-Output ("  upload {0,-38} -> {1}" -f $name, $response.state)
}

Write-Output ""
Write-Output "release assets:"
(Invoke-RestMethod -Uri "$api/releases/$($release.id)/assets" -Headers $headers -Method Get) |
  ForEach-Object { Write-Output ("  {0,-38} {1,8:N2} MB  ({2} downloads)" -f $_.name, ($_.size / 1MB), $_.download_count) }
Write-Output "page: $($release.html_url)"
