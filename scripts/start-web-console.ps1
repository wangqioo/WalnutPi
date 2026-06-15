param(
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root",
    [string]$RemoteProjectRoot = "/home/pi/projects/WalnutPi",
    [string]$RemoteBuildUser = "pi",
    [int]$Port = 4173,
    [string]$WorkspaceRoot = "",
    [string]$RecordsDir = ""
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

Require-Command "bun"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$env:PORT = "$Port"
$env:SSH_HOST = $HostName
$env:SSH_USER = $User
$env:SSH_PASSWORD = $Password
$env:WALNUT_REMOTE_PROJECT_ROOT = $RemoteProjectRoot
$env:WALNUT_REMOTE_BUILD_USER = $RemoteBuildUser

if ($WorkspaceRoot -ne "") {
    $env:WALNUT_SCREEN_WORKSPACE_ROOT = $WorkspaceRoot
}

if ($RecordsDir -ne "") {
    $env:WALNUT_SCREEN_RECORDS_DIR = $RecordsDir
}

Write-Host "Starting WalnutPi Web console"
Write-Host ("URL:          http://127.0.0.1:{0}/" -f $Port)
Write-Host ("Preview only: http://127.0.0.1:{0}/?nossh" -f $Port)
Write-Host ("Target:       {0}@{1}" -f $User, $HostName)
Write-Host ("Remote root:  {0}" -f $RemoteProjectRoot)
Write-Host ""

Push-Location $repoRoot
try {
    & bun "web-interface/model-terminal-server.js"
    if ($LASTEXITCODE -ne 0) {
        throw "Web console exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
