# Buttondown CLI

A command-line interface for [Buttondown](https://buttondown.com/) to sync your newsletters and media with a local folder.

## Features

- **Back up your content**: Pull your emails and media from Buttondown to your local machine
- **Work locally**: Edit emails in your favorite editor using Markdown
- **Deploy changes**: Push your local changes back to Buttondown
- **Sync media**: Upload and download images using the Buttondown API

## Installation

```bash
# Install globally
npm install -g @buttondown/cli

# Or use with npx
npx @buttondown/cli
```

## Usage

### Authentication

The CLI supports two authentication methods:

**OAuth (recommended)** - Opens your browser to authenticate:

```bash
buttondown login
```

**API Key** - Provide your API key directly (useful for CI/automation):

```bash
buttondown login --api-key=your-api-key
```

#### Local Development

When developing against a local Buttondown instance with HTTPS (e.g., using Caddy), you may need to bypass certificate validation:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 buttondown login --base-url https://application.bd
```

Or point Node.js to your local CA certificate:

```bash
NODE_EXTRA_CA_CERTS=/path/to/caddy/root.crt buttondown login --base-url https://application.bd
```

### Download Content

Pull your emails, automations, and media from Buttondown:

```bash
buttondown pull
```

By default, this will create a `./buttondown` directory in your current folder. You can specify a different directory:

```bash
buttondown pull --directory=./my-newsletter
```

This command will:

- Download your newsletter settings as `newsletter.json`
- Download all your automations to `automations.yaml`
- Download all your emails as Markdown files in `emails/`
- Download all your images to `media/`

### Upload Content

After making local changes, push them back to Buttondown:

```bash
buttondown push
```

Or specify a different directory:

```bash
buttondown push --directory=./my-newsletter
```

This command will:

- Upload any new or modified emails to Buttondown
- Upload any new or modified automations to Buttondown
- Upload any new media files in the `media/` directory to Buttondown's image storage

### File Structure

The CLI creates the following directory structure:

```
my-newsletter/
├── newsletter.json    # Newsletter settings
├── automations.yaml   # Your automations
├── emails/            # Your emails as Markdown files
│   ├── newsletter-issue-1.md
│   └── newsletter-issue-2.md
└── media/             # Images and media files
    ├── image1.png
    └── document.pdf
```

The CLI keeps track of all media files in the `.buttondown.json` configuration file, including their IDs, URLs, and sync status. This tracking allows the CLI to avoid unnecessary re-uploads and downloads when syncing content.

### Email Format

Emails are stored as `.md` files with frontmatter:

```markdown
---
id: email-id
subject: My Newsletter Issue #1
status: draft
email_type: public
slug: newsletter-issue-1
publish_date: 2025-04-27T09:00:00Z
created: 2025-04-25T15:32:18Z
modified: 2025-04-26T10:45:22Z
attachments:
  - attachment-id-1
  - attachment-id-2
---

# My Newsletter Issue #1

Hello subscribers!

This is the content of my email...

![My image](https://buttondown.s3.amazonaws.com/images/123456-example.png)
```

When writing your emails, you can reference images that you've uploaded using the CLI. Once you've pushed images to Buttondown using `buttondown push`, you can reference them in your emails by their URL.

## Commands

- `buttondown login` - Authenticate with Buttondown
- `buttondown logout` - Clear stored credentials
- `buttondown create` - Create a new draft email locally
- `buttondown pull` - Download content from Buttondown
- `buttondown push` - Upload content to Buttondown

## Options

- `--api-key, -k` - Your Buttondown API key (for login)
- `--directory, -d` - Directory to store or read Buttondown content (default: ./buttondown)
- `--title, -t` - Title for new email (with create command)
- `--force, -f` - Force operation without confirmation
- `--help` - Show help message
- `--version` - Show version number

## License

MIT
