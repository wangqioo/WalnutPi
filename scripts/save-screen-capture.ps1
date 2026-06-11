param(
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root",
    [string]$OutputPath = "web-interface/screen-sync-records/latest-device-frame.png"
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

Require-Command "sshpass"
Require-Command "ssh"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $resolvedOutputPath = $OutputPath
} else {
    $resolvedOutputPath = Join-Path $repoRoot $OutputPath
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
if ($outputDirectory -and -not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

Write-Host ("Capturing screen from {0}@{1}" -f $User, $HostName)
$json = & sshpass -p $Password ssh `
    -o StrictHostKeyChecking=no `
    -o UserKnownHostsFile=/dev/null `
    -o LogLevel=ERROR `
    "$User@$HostName" `
    "sudo -n walnut screen capture --png-base64"

if ($LASTEXITCODE -ne 0) {
    throw "Remote screen capture failed with code $LASTEXITCODE."
}

$capture = $json | ConvertFrom-Json
if (-not $capture.pngBase64) {
    throw "Remote capture did not include pngBase64."
}

[System.IO.File]::WriteAllBytes($resolvedOutputPath, [System.Convert]::FromBase64String($capture.pngBase64))

Write-Host ("Saved:      {0}" -f $resolvedOutputPath)
Write-Host ("size:       {0}x{1}" -f $capture.width, $capture.height)
Write-Host ("isBlank:    {0}" -f $capture.isBlank)
Write-Host ("pngSha256:  {0}" -f $capture.pngSha256)
Write-Host ("rawSha256:  {0}" -f $capture.rawSha256)
