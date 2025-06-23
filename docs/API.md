# Gitea MCP Server API Documentation

## Overview

The Gitea MCP Server provides two primary tools for interacting with self-hosted Gitea instances through the Model Context Protocol (MCP).

## Authentication

All API calls require authentication via personal access tokens configured in the environment variables. Each Gitea instance must have its own token with appropriate permissions.

### Required Permissions

- `repo`: Full repository access
- `write:repository`: Create repositories
- `read:user`: Read user information

## Tools

### create_repository

Creates a new repository on the specified Gitea instance.

**Tool Name:** `create_repository`

**Description:** Create a new repository on Gitea instance

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instanceId` | string | ✓ | - | Gitea instance identifier from configuration |
| `name` | string | ✓ | - | Repository name (must be valid Git repository name) |
| `description` | string | ✗ | "" | Repository description |
| `private` | boolean | ✗ | true | Whether the repository should be private |
| `autoInit` | boolean | ✗ | true | Initialize repository with README.md |
| `defaultBranch` | string | ✗ | "main" | Default branch name |

**Example Request:**

```json
{
  "tool": "create_repository",
  "arguments": {
    "instanceId": "main",
    "name": "my-awesome-project",
    "description": "An awesome project for demonstrating Gitea MCP",
    "private": true,
    "autoInit": true,
    "defaultBranch": "main"
  }
}
```

**Example Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"success\": true,\n  \"repository\": {\n    \"id\": 123,\n    \"name\": \"my-awesome-project\",\n    \"fullName\": \"username/my-awesome-project\",\n    \"url\": \"https://gitea.example.com/username/my-awesome-project\",\n    \"cloneUrl\": \"https://gitea.example.com/username/my-awesome-project.git\",\n    \"sshUrl\": \"git@gitea.example.com:username/my-awesome-project.git\",\n    \"private\": true,\n    \"createdAt\": \"2023-12-01T10:00:00Z\"\n  }\n}"
    }
  ]
}
```

**Error Responses:**

- `VALIDATION_ERROR`: Invalid parameters provided
- `NOT_FOUND`: Gitea instance not found
- `UNAUTHORIZED`: Authentication failed
- `EXTERNAL_API_ERROR`: Repository creation failed

### upload_files

Uploads multiple files to a Gitea repository while preserving directory structure.

**Tool Name:** `upload_files`

**Description:** Upload files and folders to Gitea repository while preserving directory structure

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instanceId` | string | ✓ | - | Gitea instance identifier from configuration |
| `owner` | string | ✓ | - | Repository owner username |
| `repository` | string | ✓ | - | Repository name |
| `files` | array | ✓ | - | Array of file objects to upload |
| `files[].path` | string | ✓ | - | File path within repository (forward slashes) |
| `files[].content` | string | ✓ | - | File content (UTF-8 text) |
| `message` | string | ✓ | - | Commit message for the upload |
| `branch` | string | ✗ | "main" | Target branch name |
| `batchSize` | number | ✗ | 10 | Number of files to upload per batch |

**File Path Rules:**

- Use forward slashes (`/`) for directory separators
- No leading slash (relative paths only)
- No `..` sequences (security restriction)
- No empty directory names

**Example Request:**

```json
{
  "tool": "upload_files",
  "arguments": {
    "instanceId": "main",
    "owner": "username",
    "repository": "my-awesome-project",
    "files": [
      {
        "path": "README.md",
        "content": "# My Awesome Project\n\nThis is an awesome project!"
      },
      {
        "path": "src/index.js",
        "content": "console.log('Hello, World!');"
      },
      {
        "path": "src/utils/helper.js",
        "content": "export function greet(name) {\n  return `Hello, ${name}!`;\n}"
      },
      {
        "path": "package.json",
        "content": "{\n  \"name\": \"my-awesome-project\",\n  \"version\": \"1.0.0\"\n}"
      }
    ],
    "message": "Initial project setup with source files",
    "branch": "main",
    "batchSize": 5
  }
}
```

**Example Response:**

```json
{
  "content": [
    {
      "type": "text", 
      "text": "{\n  \"success\": true,\n  \"summary\": {\n    \"totalFiles\": 4,\n    \"uploaded\": 4,\n    \"failed\": 0\n  },\n  \"details\": {\n    \"repository\": \"username/my-awesome-project\",\n    \"branch\": \"main\",\n    \"commitMessage\": \"Initial project setup with source files\"\n  }\n}"
    }
  ]
}
```

**Partial Failure Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"success\": false,\n  \"summary\": {\n    \"totalFiles\": 4,\n    \"uploaded\": 3,\n    \"failed\": 1\n  },\n  \"details\": {\n    \"failures\": [\n      \"File 'src/duplicate.js' already exists\"\n    ],\n    \"repository\": \"username/my-awesome-project\",\n    \"branch\": \"main\",\n    \"commitMessage\": \"Initial project setup with source files\"\n  }\n}"
    }
  ]
}
```

**Error Responses:**

- `VALIDATION_ERROR`: Invalid parameters or file paths
- `NOT_FOUND`: Gitea instance or repository not found
- `UNAUTHORIZED`: Authentication failed or insufficient permissions
- `EXTERNAL_API_ERROR`: File upload failed

### sync_project

Automatically discovers and syncs an entire project directory to a Gitea repository while respecting `.gitignore` rules.

**Tool Name:** `sync_project`

**Description:** Sync entire project to Gitea repository while respecting .gitignore rules

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instanceId` | string | ✓ | - | Gitea instance identifier from configuration |
| `owner` | string | ✓ | - | Repository owner username |
| `repository` | string | ✓ | - | Repository name |
| `message` | string | ✓ | - | Commit message for the sync |
| `branch` | string | ✗ | "main" | Target branch name |
| `projectPath` | string | ✗ | "." | Path to project directory to sync |
| `dryRun` | boolean | ✗ | false | Preview what would be uploaded without actually uploading |
| `includeHidden` | boolean | ✗ | false | Include hidden files (starting with .) |
| `maxFileSize` | number | ✗ | 1048576 | Maximum file size in bytes (1MB default) |
| `textOnly` | boolean | ✗ | true | Only upload text files (skip binary files) |

**Features:**

- **Gitignore Support**: Automatically reads and applies `.gitignore` rules
- **Smart Defaults**: Includes sensible defaults for common ignore patterns (node_modules/, .git/, etc.)
- **File Discovery**: Recursively scans project directory for eligible files
- **Binary Detection**: Simple heuristic to detect and optionally skip binary files
- **Size Filtering**: Skip files that exceed size limits
- **Dry Run Mode**: Preview what would be uploaded without making changes
- **Progress Reporting**: Detailed reporting of discovered, filtered, uploaded, and failed files

**Example Request:**

```json
{
  "tool": "sync_project",
  "arguments": {
    "instanceId": "main",
    "owner": "username", 
    "repository": "my-project",
    "message": "Sync project files",
    "branch": "main",
    "projectPath": "./my-app",
    "dryRun": false,
    "includeHidden": false,
    "maxFileSize": 2097152,
    "textOnly": true
  }
}
```

**Example Dry Run Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"dryRun\": true,\n  \"summary\": {\n    \"discovered\": 15,\n    \"filtered\": 15,\n    \"uploaded\": 0,\n    \"failed\": 0,\n    \"skipped\": 0\n  },\n  \"files\": [\n    {\n      \"path\": \"src/index.js\",\n      \"size\": 1024,\n      \"isText\": true\n    },\n    {\n      \"path\": \"package.json\",\n      \"size\": 512,\n      \"isText\": true\n    }\n  ]\n}"
    }
  ]
}
```

**Example Success Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"success\": true,\n  \"summary\": {\n    \"discovered\": 15,\n    \"filtered\": 0,\n    \"uploaded\": 15,\n    \"failed\": 0,\n    \"skipped\": 0\n  },\n  \"details\": {\n    \"repository\": \"username/my-project\",\n    \"branch\": \"main\",\n    \"commitMessage\": \"Sync project files\"\n  }\n}"
    }
  ]
}
```

**Gitignore Processing:**

The tool automatically applies gitignore rules in this order:

1. **Project .gitignore**: Reads `.gitignore` file from project root if it exists
2. **Sensible Defaults**: Applies common ignore patterns:
   - `node_modules/`
   - `.git/`
   - `.env` 
   - `*.log`
   - `.DS_Store`
   - `Thumbs.db`
   - `build/`
   - `dist/`
   - `coverage/`
   - `.nyc_output/`

**Error Responses:**

- `VALIDATION_ERROR`: Invalid parameters or project path
- `NOT_FOUND`: Gitea instance, repository, or project path not found
- `UNAUTHORIZED`: Authentication failed or insufficient permissions
- `EXTERNAL_API_ERROR`: File sync failed

### sync_update

Advanced tool for updating existing files in Gitea repository with conflict resolution, using Gitea's PUT API for updates and POST API for batch operations.

**Tool Name:** `sync_update`

**Description:** Advanced tool for updating existing files in Gitea repository with conflict resolution

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `instanceId` | string | ✓ | - | Gitea instance identifier from configuration |
| `owner` | string | ✓ | - | Repository owner username |
| `repository` | string | ✓ | - | Repository name |
| `files` | array | ✓ | - | Array of file operation objects |
| `files[].path` | string | ✓ | - | File path in repository (forward slashes) |
| `files[].content` | string | ✗ | - | File content (text, required for add/modify operations) |
| `files[].operation` | string | ✓ | - | Operation: 'add' (create new), 'modify' (update existing), 'delete' (remove) |
| `files[].sha` | string | ✗ | auto-detect | Current file SHA (required for modify/delete, auto-detected if not provided) |
| `message` | string | ✓ | - | Commit message for all operations |
| `branch` | string | ✗ | "main" | Target branch name |
| `strategy` | string | ✗ | "auto" | Update strategy: 'auto' (choose best), 'batch' (single commit), 'individual' (separate commits) |
| `conflictResolution` | string | ✗ | "fail" | Conflict handling: 'fail' (stop on conflict), 'overwrite' (force update), 'skip' (ignore conflicts) |
| `detectChanges` | boolean | ✗ | true | Compare with remote files to avoid unnecessary updates |
| `dryRun` | boolean | ✗ | false | Preview operations without making changes |

**Key Features:**

- **Smart Updates**: Uses PUT API for updating existing files, POST for creating new files
- **Change Detection**: Compares local vs remote content to skip unnecessary updates
- **Auto SHA Resolution**: Automatically fetches required SHA values for update operations
- **Multiple Strategies**: Supports batch operations (single commit) or individual operations (separate commits)
- **Conflict Resolution**: Handles cases where remote files have changed since last sync
- **Mixed Operations**: Can handle create, update, and delete operations in a single call
- **Dry Run Mode**: Preview what operations would be performed without making changes

**Example Request:**

```json
{
  "tool": "sync_update",
  "arguments": {
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
}
```

**Example Dry Run Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"dryRun\": true,\n  \"strategy\": \"individual\",\n  \"summary\": {\n    \"discovered\": 3,\n    \"analyzed\": 3,\n    \"needsUpdate\": 2,\n    \"processed\": 0,\n    \"succeeded\": 0,\n    \"failed\": 0,\n    \"skipped\": 0\n  },\n  \"filesNeedingUpdate\": [\n    {\n      \"path\": \"README.md\",\n      \"operation\": \"modify\",\n      \"hasRemoteSha\": true\n    },\n    {\n      \"path\": \"src/new-feature.js\",\n      \"operation\": \"add\",\n      \"hasRemoteSha\": false\n    }\n  ]\n}"
    }
  ]
}
```

**Example Success Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"success\": true,\n  \"strategy\": \"individual\",\n  \"summary\": {\n    \"discovered\": 3,\n    \"analyzed\": 3,\n    \"needsUpdate\": 2,\n    \"processed\": 2,\n    \"succeeded\": 2,\n    \"failed\": 0,\n    \"skipped\": 0\n  },\n  \"details\": {\n    \"repository\": \"username/my-project\",\n    \"branch\": \"main\",\n    \"commitMessage\": \"Update documentation and add new feature\",\n    \"operations\": [\n      {\n        \"file\": \"README.md\",\n        \"operation\": \"modify\",\n        \"status\": \"success\"\n      },\n      {\n        \"file\": \"src/new-feature.js\",\n        \"operation\": \"add\",\n        \"status\": \"success\"\n      }\n    ]\n  }\n}"
    }
  ]
}
```

**Operation Types:**

- **add**: Create a new file (uses POST API, no SHA required)
- **modify**: Update an existing file (uses PUT API, requires SHA for conflict resolution)
- **delete**: Remove an existing file (uses DELETE API, requires SHA)

**Strategy Options:**

- **auto**: Automatically chooses the best strategy based on file count and operation types
- **batch**: Performs all operations in a single commit using Gitea's batch API
- **individual**: Performs each operation as a separate commit

**Change Detection:**

When `detectChanges` is true (default), the tool:
1. Fetches current file content and SHA from remote repository
2. Compares local content with remote content
3. Skips files where content is identical (for modify operations)
4. Auto-populates SHA values for modify/delete operations
5. Reports files that don't need updating

**Error Responses:**

- `VALIDATION_ERROR`: Invalid parameters, file paths, or operation types
- `NOT_FOUND`: Gitea instance, repository, or file not found
- `UNAUTHORIZED`: Authentication failed or insufficient permissions
- `EXTERNAL_API_ERROR`: Gitea API error during update operations

## Rate Limiting

The server implements rate limiting per Gitea instance to respect API limits:

- Default: 100 requests per minute per instance
- Configurable via `rateLimit` in instance configuration
- Automatic retry with exponential backoff on rate limit errors

## Batch Processing

File uploads are processed in batches to optimize performance and respect rate limits:

- Default batch size: 10 files
- Configurable per request via `batchSize` parameter
- 1-second delay between batches
- Each batch processed concurrently within the batch

## Error Handling

All tools implement comprehensive error handling:

### Error Codes

- `VALIDATION_ERROR`: Invalid input parameters
- `NOT_FOUND`: Resource not found (instance, repository, etc.)
- `UNAUTHORIZED`: Authentication or permission issues
- `EXTERNAL_API_ERROR`: Gitea API errors
- `RATE_LIMITED`: Rate limit exceeded
- `INTERNAL_ERROR`: Server internal errors

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "additional": "context information"
    }
  }
}
```

## Configuration Management

### Instance Configuration

Each Gitea instance requires configuration in the `GITEA_INSTANCES` environment variable:

```json
[
  {
    "id": "production",
    "name": "Production Gitea",
    "baseUrl": "https://gitea.company.com",
    "token": "your-production-token",
    "timeout": 30000,
    "rateLimit": {
      "requests": 100,
      "windowMs": 60000
    }
  }
]
```

### Instance Selection

Use the `instanceId` parameter to specify which configured Gitea instance to use for each operation. The instance ID must match one configured in the environment.

## Usage Examples

### Creating a Repository and Uploading Files

1. **Create Repository:**

```json
{
  "tool": "create_repository",
  "arguments": {
    "instanceId": "main",
    "name": "web-app",
    "description": "A modern web application",
    "private": false
  }
}
```

2. **Upload Project Files:**

```json
{
  "tool": "upload_files", 
  "arguments": {
    "instanceId": "main",
    "owner": "myusername",
    "repository": "web-app",
    "files": [
      {
        "path": "index.html",
        "content": "<!DOCTYPE html>\n<html>\n<head>\n  <title>My Web App</title>\n</head>\n<body>\n  <h1>Welcome!</h1>\n</body>\n</html>"
      },
      {
        "path": "css/style.css", 
        "content": "body {\n  font-family: Arial, sans-serif;\n  margin: 0;\n  padding: 20px;\n}"
      },
      {
        "path": "js/app.js",
        "content": "document.addEventListener('DOMContentLoaded', function() {\n  console.log('Web app loaded!');\n});"
      }
    ],
    "message": "Initial web app structure"
  }
}
```

### Working with Multiple Instances

```json
{
  "tool": "create_repository",
  "arguments": {
    "instanceId": "development",
    "name": "test-repo",
    "description": "Development testing repository"
  }
}
```

Then upload to production:

```json
{
  "tool": "upload_files",
  "arguments": {
    "instanceId": "production", 
    "owner": "myusername",
    "repository": "live-repo",
    "files": [...],
    "message": "Deploy to production"
  }
}
```

## Security Considerations

### Token Security

- Store tokens securely in environment variables
- Use minimal required permissions
- Rotate tokens regularly
- Never log or expose tokens in responses

### Input Validation

- All file paths are validated for security
- Path traversal attempts (`../`) are blocked
- File content is validated as UTF-8 text
- Repository and user names are validated

### Rate Limiting

- Respect Gitea instance rate limits
- Implement exponential backoff on failures
- Use appropriate batch sizes for bulk operations

## Monitoring and Logging

### Log Levels

- `debug`: Detailed operational information
- `info`: General operational events  
- `warn`: Warning conditions
- `error`: Error conditions

### Metrics

The server tracks these metrics:

- Tool execution counts
- Success/failure rates
- Response times
- Rate limit hits
- API errors by type

### Health Checks

Monitor server health via:

- Process health (main process running)
- Configuration validity
- Gitea instance connectivity
- Memory and CPU usage

## Troubleshooting

### Common Issues

**"Gitea instance 'xyz' not found"**
- Verify `instanceId` matches configuration
- Check `GITEA_INSTANCES` environment variable

**"Authentication failed"**
- Verify access token is correct
- Check token permissions
- Ensure token hasn't expired

**"Repository not found"**
- Verify repository exists
- Check owner username is correct
- Ensure you have access to the repository

**"File upload failed"**
- Check file paths are valid
- Verify repository write permissions
- Ensure files don't already exist (if creating new files)

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
LOG_LEVEL=debug npm start
```

This provides detailed information about:
- API requests and responses
- Rate limiting decisions
- Retry attempts
- Configuration loading
- Error details
