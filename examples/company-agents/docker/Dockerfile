# The onboarding image: everything a new person needs to run the company's agents, on a Mac (Intel or Apple silicon)
# or a Windows PC with Docker Desktop, without installing Node, the Claude Code CLI or any MCP server themselves.
#
#   docker compose run --rm co doctor          is this set up?
#   docker compose run --rm co ask "..."       any co command
#   docker compose run --rm onboard            the guided first run
#
# No secret is baked in. Tokens arrive through the .env file (see .env.example) or through `co login` inside the
# container, whose credential file lives in a named volume so it survives the container. The image is linux/amd64 and
# linux/arm64; Docker picks the right one.

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base

ARG TARGETARCH
# Pin these before the company's first real use; "latest" is for trying it out.
ARG CLAUDE_CODE_VERSION=latest
ARG GITHUB_MCP_VERSION=latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates jq tini \
 && rm -rf /var/lib/apt/lists/*

# The Claude Code CLI: the agents run through it, and a person signs in with it once (claude login) when the company
# uses subscriptions rather than an API key.
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# The GitHub MCP server as a binary, so no Docker-in-Docker is needed. Read-only is set at run time (lib/mcp.ts).
RUN set -eux; \
    arch="${TARGETARCH:-amd64}"; \
    if [ "$GITHUB_MCP_VERSION" = "latest" ]; then \
      url=$(curl -fsSL https://api.github.com/repos/github/github-mcp-server/releases/latest \
        | jq -r --arg a "$arch" '.assets[] | select(.name | test("Linux_" + (if $a == "amd64" then "x86_64" else "arm64" end) + "\\.tar\\.gz$")) | .browser_download_url'); \
    else \
      case "$arch" in amd64) ga=x86_64;; *) ga=arm64;; esac; \
      url="https://github.com/github/github-mcp-server/releases/download/v${GITHUB_MCP_VERSION}/github-mcp-server_Linux_${ga}.tar.gz"; \
    fi; \
    curl -fsSL "$url" | tar -xz -C /usr/local/bin github-mcp-server; \
    chmod +x /usr/local/bin/github-mcp-server

# The TestRail MCP server is fetched by npx on first use; warm the cache so the first run is not slow.
RUN npx -y @bun913/mcp-testrail@latest --help >/dev/null 2>&1 || true

# The repository that holds the agents. A company copies this folder into its own repository and builds from there,
# so the build context is the repository root (see docker-compose.yml).
WORKDIR /opt/agents
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install --no-save tsx@4 zod@4 @anthropic-ai/claude-agent-sdk >/dev/null
COPY examples/company-agents ./examples/company-agents

# `co` on the PATH, and a non-root user whose home holds the logins (mounted as volumes in docker-compose.yml).
COPY examples/company-agents/docker/bin/co /usr/local/bin/co
COPY examples/company-agents/docker/onboard.sh /usr/local/bin/onboard
RUN chmod +x /usr/local/bin/co /usr/local/bin/onboard \
 && useradd --create-home --shell /bin/bash agent \
 && mkdir -p /home/agent/.co /home/agent/.claude /work \
 && chown -R agent:agent /home/agent /work /opt/agents

USER agent
# The company's repository is mounted here; agents read the repository they run in.
WORKDIR /work
ENV CO_HOME=/opt/agents
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["co", "--help"]
