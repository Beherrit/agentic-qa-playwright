#!/usr/bin/env bash
# The guided first run. Nothing here is clever: it tells the person what is set up, asks for what is not, and ends
# with `co doctor` saying "Ready." It can be run again any time; it changes nothing that is already in place.
set -euo pipefail

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { local v; read -r -p "$1 " v </dev/tty; printf '%s' "$v"; }

say "Welcome. This sets you up to run the company's agents from the command line."
echo "Everything an agent posts is posted as you, with your own tokens, so the first step is who you are."

if [ ! -f /work/co.config.json ]; then
  say "There is no co.config.json in the repository mounted at /work."
  echo "Copy examples/company-agents/cli/co.config.example.json to the repository root as co.config.json, fill in the"
  echo "company's systems, and run onboard again. Until then only co --help works."
  exit 1
fi

say "1. Who you are"
if [ -f "$HOME/.co/credentials.json" ]; then
  echo "Already logged in as $(jq -r .login "$HOME/.co/credentials.json"). Run 'co login' to change it."
else
  login=$(ask "Your login in the tracker (the name on your Jira or GitHub account):")
  tracker=$(jq -r .tracker /work/co.config.json)
  host=$(jq -r .repoHost /work/co.config.json)
  tokens=()
  [ "$host" = "github" ] && tokens+=(--token GITHUB_TOKEN)
  [ "$host" = "gitlab" ] && tokens+=(--token GITLAB_TOKEN)
  [ "$tracker" = "jira" ] && tokens+=(--token JIRA_BASE_URL --token JIRA_EMAIL --token JIRA_TOKEN)
  [ "$(jq -r .docs /work/co.config.json)" = "confluence" ] && tokens+=(--token CONFLUENCE_BASE_URL --token CONFLUENCE_TOKEN)
  [ "$(jq -r '.project.testrail // empty' /work/co.config.json)" != "" ] && tokens+=(--token TESTRAIL_URL --token TESTRAIL_USERNAME --token TESTRAIL_API_KEY)
  echo "You will be asked for each token the config needs. A value already in the environment (.env) is taken without asking."
  echo "Leave one empty to skip it; co doctor will remind you."
  co login --login "$login" "${tokens[@]}"
fi

say "2. The model"
if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "A model key is in the environment."
elif [ -f "$HOME/.claude/.credentials.json" ] || claude auth status >/dev/null 2>&1; then
  echo "The Claude Code CLI is signed in."
else
  echo "No model access yet. Either put ANTHROPIC_API_KEY in .env, or sign in with a subscription now:"
  echo "    claude"
  echo "then /login, follow the browser steps, and exit. The sign-in is kept in a volume for next time."
fi

say "3. Check"
co doctor || true

say "Next"
cat <<'EOF'
  co ask "how do I run the tests?"          read-only; a good first command
  co mr describe <number> --dry             see what the describer would post, without posting
  co ticket new "<a wish>"                  the full flow; it asks before filing
  co --help                                 everything else

The repository is mounted at /work; agents read it and nothing else on your machine. Logins live in Docker volumes
(co-credentials, claude-config): `docker volume rm company-agents_co-credentials` forgets them.
EOF
