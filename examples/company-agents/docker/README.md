# The onboarding container

One image, built once, that gives a new person everything to run the agents on a Mac or a Windows PC: Node, the
Claude Code CLI, the `co` command, the GitHub MCP server binary, and the TestRail MCP server warmed in the npm cache.
They install Docker Desktop, copy one file, run one command, and answer the questions.

Nothing secret is in the image. Tokens come from a `.env` file at the repository root or from `co login` inside the
container, and the logins are kept in Docker volumes, not in the image and not on the image registry.

## For the person being onboarded

1. Install Docker Desktop (Mac: Intel or Apple silicon; Windows: with the WSL 2 backend it offers by default).
2. Clone the company repository and open a terminal at its root.
3. Copy the environment template and fill in what you have been given. Leave the rest empty.

   ```bash
   cp examples/company-agents/docker/.env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item examples\company-agents\docker\.env.example .env
   ```

4. Build and run the guided setup:

   ```bash
   docker compose -f examples/company-agents/docker/docker-compose.yml build
   docker compose -f examples/company-agents/docker/docker-compose.yml run --rm onboard
   ```

   It asks who you are and for your tokens, points you at the model sign-in if there is none, and ends with
   `co doctor` listing each check as ok, warn or FAIL.

5. Make `co` a word. Mac or Linux, in `~/.zshrc`:

   ```bash
   alias co='/path/to/repo/examples/company-agents/docker/co.sh'
   ```

   Windows, in your PowerShell profile (`notepad $PROFILE`):

   ```powershell
   function co { & "C:\path\to\repo\examples\company-agents\docker\co.ps1" @args }
   ```

6. Try it:

   ```bash
   co doctor
   co ask "how do I run the tests?"
   co mr describe 1234 --dry
   ```

## For the person setting it up for the company

- **Build context is the repository root**, so the image carries the agents folder and the lockfile. A company copies
  `examples/company-agents/` into its own repository and builds from there; the Dockerfile's `COPY` lines are the only
  paths to change if the folder moves.
- **Pin versions** in `.env` (`CLAUDE_CODE_VERSION`, `GITHUB_MCP_VERSION`) before real use. `latest` is for trying it.
- **Publish the image** to the company registry from CI once, so new people pull instead of build:
  `docker build -f examples/company-agents/docker/Dockerfile -t registry.acme.example/company-agents/co:1.0 .` and
  change `image:` in the compose file. Multi-arch with `docker buildx build --platform linux/amd64,linux/arm64`.
- **`.env` is in `.gitignore`.** Check it is in yours.
- **Official values later.** When the company has service accounts, API keys and SSH keys, they go in the company's
  secret manager and arrive in `.env` through whatever the company uses for that (1Password CLI, Vault agent, Doppler).
  Nothing in the kit changes: the names are the names in `.env.example`.
- **SSH keys** are not needed by the agents: they read the repository that is mounted and talk to the code host over
  HTTPS with a token. A person's own git over SSH is their own setup, outside the container.

## Mac and Windows differences, handled

| Concern | How |
|---|---|
| Home directory paths (`$HOME` vs `%USERPROFILE%`) | Logins live in named volumes, not bind mounts, so no host path is needed |
| The repository path | `CO_WORKDIR` in `.env`, forward slashes on both; defaults to the repository the compose file is in |
| Line endings | `.gitattributes` keeps the shell scripts LF so the image runs them on a Windows checkout |
| Apple silicon | The base image and the GitHub MCP binary are fetched for `TARGETARCH`; one Dockerfile |
| Figma desktop app on the host | The container reaches it at `host.docker.internal:3845`; set `mcp.figma.desktopUrl` to `http://host.docker.internal:3845/mcp` when running `co` in Docker |
| Terminal prompts (`co login`, confirmations) | `run --rm` allocates a TTY; both wrappers pass it through |
| File permissions on `credentials.json` | Mode 0600 inside the Linux container regardless of the host |

## What the container cannot do

- Run the GitHub MCP server in its own Docker mode: there is no Docker inside the container. The image uses the binary
  (`mcp.github.mode: "binary"`), which is the same server.
- Open a browser for OAuth sign-ins. `claude` prints a URL to open on the host and a code to paste back, which works.
  Figma's hosted server wants OAuth too; in the container use `desktop` mode (the app on the host) or a `FIGMA_TOKEN`.
- Reach anything on the host other than the Figma port. That is on purpose.

## VS Code and Codespaces

[.devcontainer/devcontainer.json](.devcontainer/devcontainer.json) opens the same container as a dev container, with
the repository at `/work` and `co doctor` run on create. Copy the folder to the repository root as `.devcontainer/`
and adjust the compose path, or point VS Code at it where it is.
