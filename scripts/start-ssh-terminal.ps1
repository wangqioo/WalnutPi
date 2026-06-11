param(
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root",
    [int]$Port = 4174
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

Require-Command "bun"
Require-Command "sshpass"
Require-Command "ssh"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$env:PORT = "$Port"
$env:SSH_HOST = $HostName
$env:SSH_USER = $User
$env:SSH_PASSWORD = $Password

Write-Host "Starting WalnutPi SSH terminal"
Write-Host ("URL:    http://127.0.0.1:{0}/" -f $Port)
Write-Host ("Target: {0}@{1}" -f $User, $HostName)
Write-Host ""

Push-Location (Join-Path $repoRoot "web-interface")
try {
    & bun "ssh-terminal-server.js"
    if ($LASTEXITCODE -ne 0) {
        throw "SSH terminal exited with code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}
