# `co` from PowerShell on Windows, through Docker Desktop. Put this folder on your PATH, or add to your profile:
#   function co { & "C:\path\to\repo\examples\company-agents\docker\co.ps1" @args }
# Then: co doctor, co ask "...", co mr describe 1234
$compose = Join-Path $PSScriptRoot 'docker-compose.yml'
docker compose -f $compose run --rm co @args
exit $LASTEXITCODE
