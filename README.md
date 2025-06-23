# Gitea MCP Server

A production-ready Model Context Protocol (MCP) server for seamless integration with self-hosted Gitea platforms. This server provides tools for creating repositories and uploading files while preserving directory structure.

## Installation and Setup Guide

This guide provides step-by-step instructions for installing and configuring the Gitea MCP server, including troubleshooting common issues.

## Features

- **Repository Creation**: Create new repositories on any configured Gitea instance
- **File Upload**: Upload files and folders while preserving directory structure
- **Project Sync**: Automatically sync entire projects for initial commits (new files only)
- **Advanced File Updates**: Smart update tool with conflict resolution for modifying existing files
- **Multi-Instance Support**: Connect to multiple Gitea instances simultaneously
- **Rate Limiting**: Respect API rate limits per instance
- **Batch Processing**: Efficient file upload with configurable batch sizes
- **Comprehensive Logging**: Structured logging with security-safe output
- **Error Handling**: Robust error handling with retry logic
- **TypeScript**: Full type safety and modern JavaScript features

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- Access to one or more Gitea instances
- Personal access tokens for authentication

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd gitea-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your Gitea instance details
```

4. Build the project:
```bash
npm run build
```

5. Start the server:
```bash
npm run start:mcp
```

### Troubleshooting Common Issues

#### Windows Compatibility

If you're running on Windows, you might encounter issues with the build script. The default build script uses the `chmod` command, which is not available on Windows. The package.json has been updated to use a Windows-compatible build script.

#### Logging Configuration

If you encounter issues with the logging configuration, make sure you have the `pino-pretty` package installed:

```bash
npm install --save-dev pino-pretty
```

#### Environment Variables

The `.env` file should contain the following configuration:

```
# Server Configuration
NODE_ENV=development
LOG_LEVEL=debug

# Gitea Configuration
# Replace with your Gitea instance URL and token
GITEA_INSTANCES=[{"id":"main","name":"Main Gitea Instance","baseUrl":"https://your-gitea-instance.com","token":"your-personal-access-token","timeout":30000,"rateLimit":{"requests":100,"windowMs":60000}}]

# Upload Configuration
MAX_FILE_SIZE=10485760
MAX_FILES=100
BATCH_SIZE=10

# Gitea API Configuration
GITEA_TIMEOUT=30000
GITEA_MAX_RETRIES=3
```

Make sure to replace `"https://your-gitea-instance.com"` with your actual Gitea instance URL and `"your-personal-access-token"` with your Gitea personal access token.

#### Running with Debug Logging

To run the server with debug logging enabled, use the `start:mcp` script:

```bash
npm run start:mcp
```

This script sets the `NODE_ENV` to `development` and `LOG_LEVEL` to `debug` before starting the server.

### Development Setup

For development with hot reloading:

```bash
npm run dev
```

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Server Configuration
NODE_ENV=development
LOG_LEVEL=info

# Gitea Configuration
GITEA_INSTANCES='[
  {
    "id": "main",
    "name": "Main Gitea Instance", 
    "baseUrl": "https://gitea.example.com",
    "token": "your-personal-access-token",
    "timeout": 30000,
    "rateLimit": {
      "requests": 100,
      "windowMs": 60000
    }
  }
]'

# Upload Configuration
MAX_FILE_SIZE=10485760  # 10MB
MAX_FILES=100
BATCH_SIZE=10

# API Configuration
GITEA_TIMEOUT=30000
GITEA_MAX_RETRIES=3
```

### Gitea Instance Configuration

Each Gitea instance requires:

- **id**: Unique identifier for the instance
- **name**: Human-readable name for logging
- **baseUrl**: Base URL of your Gitea instance
- **token**: Personal access token with appropriate permissions
- **timeout**: Request timeout in milliseconds (optional)
- **rateLimit**: Rate limiting configuration (optional)

### Personal Access Token Setup

1. Log into your Gitea instance
2. Go to Settings → Applications → Personal Access Tokens
3. Create a new token with these permissions:
   - `repo`: Full repository access
   - `write:repository`: Create repositories
   - `read:user`: Read user information

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "gitea-mcp": {
      "command": "node",
      "args": ["./build/index.js"],
      "cwd": "/path/to/gitea-mcp",
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Other MCP Clients

The server communicates via stdio and follows the MCP protocol specification. Refer to your client's documentation for configuration details.

## Available Tools

### create_repository

Create a new repository on a specified Gitea instance.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `name` (string, required): Repository name
- `description` (string, optional): Repository description  
- `private` (boolean, default: true): Make repository private
- `autoInit` (boolean, default: true): Initialize with README
- `defaultBranch` (string, default: "main"): Default branch name

**Example:**
```json
{
  "instanceId": "main",
  "name": "my-new-repo",
  "description": "A test repository",
  "private": true,
  "autoInit": true,
  "defaultBranch": "main"
}
```

### upload_files

Upload multiple files to a repository while preserving directory structure.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `owner` (string, required): Repository owner username
- `repository` (string, required): Repository name
- `files` (array, required): Array of file objects with `path` and `content`
- `message` (string, required): Commit message
- `branch` (string, default: "main"): Target branch
- `batchSize` (number, default: 10): Files per batch

**Example:**
```json
{
  "instanceId": "main",
  "owner": "username",
  "repository": "my-repo",
  "files": [
    {
      "path": "README.md",
      "content": "# My Project\n\nProject description here."
    },
    {
      "path": "src/index.js", 
      "content": "console.log('Hello, World!');"
    }
  ],
  "message": "Initial commit",
  "branch": "main",
  "batchSize": 5
}
```

### sync_project ⚠️ Initial Commits Only

Automatically discover and sync an entire project directory to a Gitea repository while respecting `.gitignore` rules.

> **Important**: This tool is designed for initial project uploads and can only create new files. It cannot update files that already exist in the repository. For updating existing files, use the `sync_update` tool instead.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `owner` (string, required): Repository owner username
- `repository` (string, required): Repository name
- `message` (string, required): Commit message for the sync
- `branch` (string, default: "main"): Target branch
- `projectPath` (string, default: "."): Path to project directory to sync
- `dryRun` (boolean, default: false): Preview what would be uploaded without actually uploading
- `includeHidden` (boolean, default: false): Include hidden files (starting with .)
- `maxFileSize` (number, default: 1048576): Maximum file size in bytes (1MB)
- `textOnly` (boolean, default: true): Only upload text files (skip binary files)

**Features:**
- Automatically reads and applies `.gitignore` rules
- Includes sensible defaults for common ignore patterns (node_modules/, .git/, etc.)
- Recursively scans project directory for eligible files
- Simple heuristic to detect and optionally skip binary files
- Size filtering for large files
- Dry run mode for previewing changes
- Detailed reporting of discovered, filtered, uploaded, and failed files

**Use Cases:**
- Initial project setup and first commit
- Uploading new projects to empty repositories
- Bulk upload of files to new repositories

**Example:**
```json
{
  "instanceId": "main",
  "owner": "username",
  "repository": "my-project",
  "message": "Initial project sync",
  "branch": "main",
  "projectPath": "./my-app",
  "dryRun": false,
  "includeHidden": false,
  "maxFileSize": 2097152,
  "textOnly": true
}
```

### sync_update ✨ Advanced File Updates

Advanced tool for updating existing files in Gitea repository with intelligent conflict resolution and change detection.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `owner` (string, required): Repository owner username
- `repository` (string, required): Repository name
- `files` (array, required): Array of file operation objects
- `files[].path` (string, required): File path in repository (forward slashes)
- `files[].content` (string, conditional): File content (required for add/modify operations)
- `files[].operation` (string, required): Operation type: 'add', 'modify', or 'delete'
- `files[].sha` (string, optional): Current file SHA (auto-detected if not provided)
- `message` (string, required): Commit message for all operations
- `branch` (string, default: "main"): Target branch
- `strategy` (string, default: "auto"): Update strategy: 'auto', 'batch', or 'individual'
- `conflictResolution` (string, default: "fail"): Conflict handling: 'fail', 'overwrite', or 'skip'
- `detectChanges` (boolean, default: true): Compare with remote files to avoid unnecessary updates
- `dryRun` (boolean, default: false): Preview operations without making changes

**Key Features:**
- **Smart API Usage**: Uses PUT for updates, POST for creates, DELETE for removals
- **Change Detection**: Compares local vs remote content to skip unnecessary updates
- **Auto SHA Resolution**: Automatically fetches required SHA values for update operations
- **Multiple Strategies**: Auto, batch (single commit), or individual (separate commits)
- **Conflict Resolution**: Handles cases where remote files have changed since last sync
- **Mixed Operations**: Can handle create, update, and delete operations in a single call
- **Dry Run Mode**: Preview what operations would be performed without making changes

**Operation Types:**
- `add`: Create new files (equivalent to POST API)
- `modify`: Update existing files (uses PUT API with SHA for conflict resolution)
- `delete`: Remove existing files (uses DELETE API with SHA)

**Strategy Options:**
- `auto`: Intelligently chooses the best approach based on file count and operation types
- `batch`: Performs all operations in a single commit using Gitea's batch API
- `individual`: Performs each operation as a separate commit

**Use Cases:**
- Updating existing project files
- Selective file modifications
- Bulk file operations (create, update, delete)
- Incremental project updates
- Automated file maintenance

**Example:**
```json
{
  "instanceId": "main",
  "owner": "username",
  "repository": "my-project",
  "files": [
    {
      "path": "README.md",
      "content": "# Updated Project\n\nThis is an updated version of the project.",
      "operation": "modify"
    },
    {
      "path": "src/new-feature.js",
      "content": "// New feature implementation\nfunction newFeature() {\n  return 'Hello, World!';\n}",
      "operation": "add"
    },
    {
      "path": "old-file.txt",
      "operation": "delete"
    }
  ],
  "message": "Update documentation and add new feature",
  "branch": "main",
  "strategy": "auto",
  "detectChanges": true,
  "dryRun": false
}
```

**Dry Run Example Response:**
```json
{
  "dryRun": true,
  "strategy": "individual",
  "summary": {
    "discovered": 3,
    "analyzed": 3,
    "needsUpdate": 2,
    "processed": 0,
    "succeeded": 0,
    "failed": 0,
    "skipped": 0
  },
  "filesNeedingUpdate": [
    {
      "path": "README.md",
      "operation": "modify",
      "hasRemoteSha": true
    },
    {
      "path": "src/new-feature.js",
      "operation": "add",
      "hasRemoteSha": false
    }
  ]
}
```

## Tool Selection Guide

**When to use each tool:**

1. **`create_repository`**: Create new repositories
2. **`sync_project`**: Initial project upload to empty/new repositories
3. **`upload_files`**: Upload specific files with full control over the process
4. **`sync_update`**: Update existing files, create new files, or delete files in existing repositories

**Workflow Example:**
```bash
# 1. Create a new repository
create_repository → "my-new-project"

# 2. Initial upload of all project files
sync_project → Upload entire project structure

# 3. Later updates to specific files
sync_update → Modify README.md, add new features, delete old files
```

## Development

### Scripts

- `npm run build` - Build for production
- `npm run dev` - Development with hot reloading
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code
- `npm run type-check` - TypeScript type checking

### Project Structure

```
gitea-mcp/
├── src/
│   ├── index.ts              # Main server entry point
│   ├── config/               # Configuration management
│   ├── gitea/                # Gitea API client
│   ├── tools/                # MCP tool implementations
│   ├── services/             # Business logic services
│   ├── utils/                # Utilities (logging, errors, etc.)
│   └── types/                # TypeScript type definitions
├── build/                    # Compiled JavaScript
├── docs/                     # Documentation
└── package.json
```

### Adding New Tools

1. Create tool implementation in `src/tools/`
2. Add schema validation in `src/tools/schemas.ts`
3. Register tool in `src/tools/index.ts`
4. Add tests in `tests/unit/tools/`

## Deployment

### Docker

Build and run with Docker:

```bash
# Build image
docker build -t gitea-mcp .

# Run container
docker run -d \
  --name gitea-mcp \
  --env-file .env \
  gitea-mcp
```

### Production Considerations

- Use environment variables or secrets management for tokens
- Configure appropriate log levels
- Set up monitoring and health checks
- Use process managers like PM2 for Node.js applications
- Consider using Docker or Kubernetes for orchestration

## Security

### Best Practices

- Store tokens securely using environment variables or secrets management
- Use minimal required permissions for access tokens
- Validate all input parameters
- Log security events without exposing sensitive data
- Use HTTPS for all Gitea API communications
- Regularly rotate access tokens

### Rate Limiting

The server implements rate limiting per Gitea instance to respect API limits:

- Default: 100 requests per minute per instance
- Configurable via `rateLimit` in instance configuration
- Automatic retry with exponential backoff

## Troubleshooting

### Common Issues

**Authentication Failed**
- Verify access token is correct and has required permissions
- Check token hasn't expired
- Ensure base URL is correct

**Rate Limited**
- Reduce batch size for file uploads
- Adjust rate limit configuration
- Wait before retrying requests

**File Upload Failures**
- Check file content is valid
- Verify file paths don't contain illegal characters
- Ensure repository exists and you have write permissions

### Logging

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=debug npm start
```

### Health Checks

Check server status:

```bash
curl -f http://localhost:8080/health || exit 1
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Run linting and type checking
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

- GitHub Issues: Report bugs and feature requests
- Documentation: Check docs/ directory
- Examples: See examples/ directory

---

Built with ❤️ for the Gitea and MCP communities.
