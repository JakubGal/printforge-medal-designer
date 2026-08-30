$medalForgeNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$medalForgeNode = if ($medalForgeNodeCommand) {
  $medalForgeNodeCommand.Source
} else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $medalForgeNode)) {
  throw 'Node.js 22 or newer is required. Install Node.js, then run this script again.'
}

Set-Location -LiteralPath $PSScriptRoot
& $medalForgeNode --env-file-if-exists=.env server.mjs
