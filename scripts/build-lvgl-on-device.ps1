param(
    [Alias("Host")]
    [string]$HostName = "192.168.1.24",
    [string]$User = "root",
    [string]$Password = "root",
    [string]$RemoteProjectRoot = "/home/pi/projects/WalnutPi",
    [string]$RemoteBuildUser = "pi"
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

$remoteRootLiteral = $RemoteProjectRoot.Replace("'", "'\''")
$remoteBuildUserLiteral = $RemoteBuildUser.Replace("'", "'\''")

$remoteCommand = @"
set -eu
cd '$remoteRootLiteral'
if [ "`$(id -un)" = '$remoteBuildUserLiteral' ]; then
  ./scripts/build-lvgl-app.sh
else
  sudo -n -u '$remoteBuildUserLiteral' sh -lc "cd '$remoteRootLiteral' && ./scripts/build-lvgl-app.sh"
fi
sha256sum build/lvgl_app/walnut-lvgl-screen
"@

Write-Host ("Building LVGL app on {0}@{1}" -f $User, $HostName)
Write-Host ("Remote root: {0}" -f $RemoteProjectRoot)
Write-Host ("Build user:  {0}" -f $RemoteBuildUser)
Write-Host ""

& sshpass -p $Password ssh `
    -o StrictHostKeyChecking=no `
    -o UserKnownHostsFile=/dev/null `
    -o LogLevel=ERROR `
    "$User@$HostName" `
    $remoteCommand

if ($LASTEXITCODE -ne 0) {
    throw "Remote LVGL build failed with code $LASTEXITCODE."
}
