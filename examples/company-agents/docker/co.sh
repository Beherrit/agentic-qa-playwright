#!/usr/bin/env bash
# `co` from a Mac or Linux terminal, through Docker Desktop. Add to ~/.zshrc or ~/.bashrc:
#   alias co='/path/to/repo/examples/company-agents/docker/co.sh'
# Then: co doctor, co ask "...", co mr describe 1234
exec docker compose -f "$(cd "$(dirname "$0")" && pwd)/docker-compose.yml" run --rm co "$@"
