# Contributing to Buttondown CLI

Thank you for your interest in contributing to the Buttondown CLI!

## Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/buttondown-cli.git
   cd buttondown-cli
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run in development mode:

   ```bash
   npm run dev
   ```

4. Build the project:

   ```bash
   npm run build
   ```

5. Link for local testing:
   ```bash
   npm link
   ```

## Project Structure

- `src/` - Source code
  - `api.ts` - Buttondown API client
  - `sync.ts` - Sync manager for files
  - `cli.tsx` - Main CLI entry point
  - `commands/` - CLI commands
  - `components/` - React components for Ink UI

## Adding New Commands

1. Create a new file in `src/commands/` (see existing commands for reference)
2. Implement your command as a React component using Ink
3. Add the command to `src/cli.tsx`
4. Update the help text and README.md to document the command

## API Guidelines

- Keep API requests simple and use proper error handling
- Follow REST best practices
- Support API pagination for large data sets

## Testing

Currently, the project uses manual testing. Automated tests will be added in the future.

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Add your changes
4. Run `npm run build` to make sure everything builds correctly
5. Submit a PR

## Code Style

- Use TypeScript for all new code
- Follow existing code style (indent with 2 spaces)
- Use async/await for asynchronous code
- Document public functions and interfaces

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.

## Publishing a new version

(This only applies to members of the @buttondown organization. If you're not one of them and need or want a new version, please open an issue!)

Be sure to bump the version in `package.json` and `package-lock.json` to the "right version", and then:

```bash
$ bun publish
```

NPM will ask for authentication; use the credentials for the `engineering@` account, which exists in the 1Password vault.
