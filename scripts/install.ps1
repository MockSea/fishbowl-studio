# Installs the standalone Fishbowl Studio for Windows and starts it.
#
#   irm https://raw.githubusercontent.com/MockSea/fishbowl-studio/v0.2.0/scripts/install.ps1 | iex
#
# Downloads this release's Windows executable and SHA256SUMS (the release is the $release line
# below, so the script fetched from a tag installs that tag's build), refuses to install if the
# checksum doesn't match, puts it in %LOCALAPPDATA%\Programs\Fishbowl Studio (or
# $env:FISHBOWL_BIN_DIR) and runs it. Set $env:FISHBOWL_VERSION = 'v1.2.3' for another release,
# $env:FISHBOWL_NO_START = '1' to only install.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'MockSea/fishbowl-studio'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
  Write-Error "There's no standalone build for this Windows yet. Use the npx command from the README instead (needs Node 20 or newer): https://github.com/$repo"
}
$asset = 'fishbowl-studio-windows-x64.exe'
$release = 'v0.2.0'
if ($env:FISHBOWL_VERSION) { $release = $env:FISHBOWL_VERSION }
$base = "https://github.com/$repo/releases/download/$release"

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("fishbowl-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $asset..."
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')

  $want = $null
  foreach ($line in Get-Content (Join-Path $tmp 'SHA256SUMS')) {
    $parts = $line -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $asset) { $want = $parts[0].ToLower() }
  }
  $got = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $asset)).Hash.ToLower()
  if (-not $want -or $want -ne $got) {
    Write-Error "The download doesn't match its checksum in SHA256SUMS, so it wasn't installed."
  }
  Write-Host 'Checksum matches.'

  if ($env:FISHBOWL_BIN_DIR) { $dir = $env:FISHBOWL_BIN_DIR }
  else { $dir = Join-Path $env:LOCALAPPDATA 'Programs\Fishbowl Studio' }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $exe = Join-Path $dir 'fishbowl-studio.exe'
  Move-Item -Force -Path (Join-Path $tmp $asset) -Destination $exe
  Write-Host "Installed $exe"
} finally {
  Remove-Item -Recurse -Force -Path $tmp -ErrorAction SilentlyContinue
}

if ($env:FISHBOWL_NO_START) { return }
& $exe
