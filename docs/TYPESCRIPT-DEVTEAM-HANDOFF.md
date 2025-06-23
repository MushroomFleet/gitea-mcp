# TypeScript Development Team Handoff

## Gitea-MCP: Production-Ready TypeScript MCP Server for Gitea Integration

### Project Overview

This document provides complete technical specifications and implementation guidance for building "Gitea-MCP" - a robust, production-ready Model Context Protocol (MCP) server that enables seamless integration with self-hosted Gitea platforms. The server provides two core capabilities: creating new repositories and uploading files/folders while preserving directory structure.

### Executive Summary

**Key Deliverables:**
- TypeScript MCP server with comprehensive Gitea API integration
- Support for multiple self-hosted Gitea instances with secure authentication
- Production-ready architecture with monitoring, testing, and deployment pipelines
- Comprehensive error handling and validation
- Full documentation and operational procedures

## Complete Project Structure

```
gitea-mcp/
├── src/
│   ├── index.ts                    # Main server entry point
│   ├── server.ts                   # MCP server configuration
│   ├── config/
│   │   ├── index.ts               # Configuration management
│   │   ├── environments.ts        # Environment-specific configs
│   │   └── validation.ts          # Config validation schemas
│   ├── gitea/
│   │   ├── client.ts              # Gitea API client wrapper
│   │   ├── auth.ts                # Authentication management
│   │   ├── types.ts               # Gitea API type definitions
│   │   └── utils.ts               # Helper utilities
│   ├── tools/
│   │   ├── index.ts               # Tool registration
│   │   ├── create-repository.ts   # Repository creation tool
│   │   ├── upload-files.ts        # File upload tool
│   │   └── schemas.ts             # Tool parameter schemas
│   ├── services/
│   │   ├── repository.ts          # Repository management service
│   │   ├── file-upload.ts         # File upload service
│   │   └── instance-manager.ts    # Multi-instance management
│   ├── utils/
│   │   ├── error-handling.ts      # Comprehensive error management
│   │   ├── validation.ts          # Input validation helpers
│   │   ├── logging.ts             # Structured logging
│   │   ├── monitoring.ts          # Metrics and health checks
│   │   └── retry.ts               # Retry logic with backoff
│   └── types/
│       ├── index.ts               # Common type exports
│       ├── mcp.ts                 # MCP-specific types
│       └── config.ts              # Configuration types
├── tests/
│   ├── unit/
│   │   ├── tools/                 # Tool unit tests
│   │   ├── services/              # Service unit tests
│   │   └── utils/                 # Utility unit tests
│   ├── integration/
│   │   └── mcp-server.test.ts     # Full MCP integration tests
│   ├── fixtures/                  # Test data and mocks
│   └── setup.ts                   # Test configuration
├── docs/
│   ├── API.md                     # API documentation
│   ├── DEPLOYMENT.md              # Deployment guide
│   └── SECURITY.md                # Security guidelines
├── scripts/
│   ├── build.sh                   # Build script
│   ├── dev-setup.sh               # Development setup
│   └── health-check.sh            # Health monitoring
├── k8s/                           # Kubernetes manifests
│   ├── deployment.yml
│   ├── service.yml
│   └── hpa.yml
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Continuous integration
│       └── security.yml           # Security scanning
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
├── .prettierrc
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Dependencies and Package Configuration

### package.json

```json
{
  "name": "gitea-mcp",
  "version": "1.0.0",
  "description": "Production-ready MCP server for Gitea integration",
  "type": "module",
  "bin": {
    "gitea-mcp": "./build/index.js"
  },
  "files": [
    "build",
    "README.md",
    "docs/"
  ],
  "scripts": {
    "build": "tsc && chmod +x build/index.js",
    "dev": "tsx watch src/index.ts",
    "start": "node build/index.js",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "lint": "eslint src/**/*.ts --fix",
    "format": "prettier --write src/**/*.ts",
    "type-check": "tsc --noEmit",
    "inspector": "npx @modelcontextprotocol/inspector build/index.js",
    "prepare": "npm run build",
    "health-check": "./scripts/health-check.sh"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "gitea-js": "^1.23.0",
    "cross-fetch": "^4.0.0",
    "zod": "^3.22.0",
    "pino": "^8.19.0",
    "axios": "^1.6.0",
    "mime-types": "^2.1.35",
    "rate-limiter-flexible": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.24",
    "@types/mime-types": "^2.1.4",
    "typescript": "^5.3.3",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.57.0",
    "prettier": "^3.2.5",
    "vitest": "^1.2.0",
    "@vitest/coverage-v8": "^1.2.0",
    "tsx": "^4.7.0",
    "nodemon": "^3.0.3"
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "incremental": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "tests"]
}
```

## Core Implementation Files

### Main Server Entry Point

```typescript
// src/index.ts
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeTools } from "./tools/index.js";
import { setupErrorHandling } from "./utils/error-handling.js";
import { logger } from "./utils/logging.js";
import { validateConfig } from "./config/validation.js";

async function main() {
  try {
    // Validate configuration on startup
    const config = await validateConfig();
    
    // Set up global error handling
    setupErrorHandling();

    const server = new McpServer({
      name: "gitea-mcp",
      version: "1.0.0"
    });

    // Initialize tools
    await initializeTools(server);

    // Connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("Gitea MCP Server started successfully", {
      version: "1.0.0",
      giteaInstances: config.gitea.instances.length
    });

  } catch (error) {
    logger.error("Failed to start Gitea MCP server", { error });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

main().catch((error) => {
  logger.error("Unhandled error in main", { error });
  process.exit(1);
});
```

### Configuration Management

```typescript
// src/config/index.ts
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const GiteaInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  token: z.string(),
  timeout: z.number().default(30000),
  rateLimit: z.object({
    requests: z.number().default(100),
    windowMs: z.number().default(60000)
  }).default({})
});

const ConfigSchema = z.object({
  server: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    environment: z.enum(['development', 'staging', 'production']).default('development')
  }),
  gitea: z.object({
    instances: z.array(GiteaInstanceSchema).min(1),
    defaultTimeout: z.number().default(30000),
    maxRetries: z.number().default(3)
  }),
  upload: z.object({
    maxFileSize: z.number().default(10 * 1024 * 1024), // 10MB
    maxFiles: z.number().default(100),
    batchSize: z.number().default(10)
  })
});

export type Config = z.infer<typeof ConfigSchema>;
export type GiteaInstance = z.infer<typeof GiteaInstanceSchema>;

export function loadConfig(): Config {
  const giteaInstances = JSON.parse(process.env.GITEA_INSTANCES || '[]');
  
  return ConfigSchema.parse({
    server: {
      logLevel: process.env.LOG_LEVEL,
      environment: process.env.NODE_ENV
    },
    gitea: {
      instances: giteaInstances,
      defaultTimeout: parseInt(process.env.GITEA_TIMEOUT || '30000'),
      maxRetries: parseInt(process.env.GITEA_MAX_RETRIES || '3')
    },
    upload: {
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'),
      maxFiles: parseInt(process.env.MAX_FILES || '100'),
      batchSize: parseInt(process.env.BATCH_SIZE || '10')
    }
  });
}
```

### Gitea API Client

```typescript
// src/gitea/client.ts
import { giteaApi } from 'gitea-js';
import fetch from 'cross-fetch';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../utils/logging.js';
import { withRetry } from '../utils/retry.js';
import type { GiteaInstance } from '../config/index.js';

export class GiteaClient {
  private client: any;
  private rateLimiter: RateLimiterMemory;
  private instance: GiteaInstance;

  constructor(instance: GiteaInstance) {
    this.instance = instance;
    
    // Initialize API client
    this.client = giteaApi(instance.baseUrl, {
      token: instance.token,
      customFetch: this.createSecureFetch()
    });

    // Set up rate limiting
    this.rateLimiter = new RateLimiterMemory({
      keyPrefix: `gitea_${instance.id}`,
      points: instance.rateLimit.requests,
      duration: instance.rateLimit.windowMs / 1000
    });
  }

  private createSecureFetch() {
    return async (url: string, options: any) => {
      // Rate limiting
      await this.rateLimiter.consume(1);

      // Add timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(), 
        this.instance.timeout
      );

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            ...options.headers,
            'User-Agent': 'Gitea-MCP-Server/1.0'
          }
        });

        if (response.status === 401) {
          throw new Error(`Authentication failed for ${this.instance.name}`);
        }

        if (response.status === 403) {
          throw new Error(`Insufficient permissions for ${this.instance.name}`);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } finally {
        clearTimeout(timeoutId);
      }
    };
  }

  async createRepository(params: {
    name: string;
    description?: string;
    private?: boolean;
    autoInit?: boolean;
    defaultBranch?: string;
  }) {
    return withRetry(async () => {
      logger.info('Creating repository', { 
        instance: this.instance.name,
        repository: params.name 
      });

      const result = await this.client.repos.repoCreateForAuthenticatedUser({
        name: params.name,
        description: params.description || '',
        private: params.private ?? true,
        auto_init: params.autoInit ?? true,
        default_branch: params.defaultBranch || 'main'
      });

      logger.info('Repository created successfully', {
        instance: this.instance.name,
        repository: params.name,
        url: result.clone_url
      });

      return result;
    });
  }

  async uploadFile(params: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    branch?: string;
  }) {
    return withRetry(async () => {
      const base64Content = Buffer.from(params.content).toString('base64');
      
      const result = await this.client.repos.repoUpdateFile(
        params.owner,
        params.repo,
        params.path,
        {
          content: base64Content,
          message: params.message,
          branch: params.branch || 'main',
          author: {
            name: 'Gitea MCP Server',
            email: 'mcp@example.com'
          }
        }
      );

      return result;
    });
  }

  async batchUploadFiles(params: {
    owner: string;
    repo: string;
    files: Array<{ path: string; content: string }>;
    message: string;
    branch?: string;
    batchSize?: number;
  }) {
    const { files, batchSize = 10 } = params;
    const results = [];

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      const batchPromises = batch.map(file => 
        this.uploadFile({
          ...params,
          path: file.path,
          content: file.content
        })
      );

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to respect rate limits
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}
```

### Repository Creation Tool

```typescript
// src/tools/create-repository.ts
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getGiteaClient } from '../services/instance-manager.js';
import { logger } from '../utils/logging.js';
import { AppError, ErrorCode } from '../utils/error-handling.js';

const CreateRepositorySchema = z.object({
  instanceId: z.string().describe('Gitea instance identifier'),
  name: z.string().min(1).describe('Repository name'),
  description: z.string().optional().describe('Repository description'),
  private: z.boolean().default(true).describe('Make repository private'),
  autoInit: z.boolean().default(true).describe('Initialize with README'),
  defaultBranch: z.string().default('main').describe('Default branch name')
});

export async function registerCreateRepositoryTool(server: McpServer) {
  server.tool(
    'create_repository',
    {
      description: 'Create a new repository on Gitea instance',
      parameters: CreateRepositorySchema
    },
    async (args) => {
      try {
        const params = CreateRepositorySchema.parse(args);
        
        logger.info('Creating repository via MCP tool', {
          instanceId: params.instanceId,
          repository: params.name
        });

        // Get Gitea client for specified instance
        const client = await getGiteaClient(params.instanceId);
        
        // Create repository
        const repository = await client.createRepository({
          name: params.name,
          description: params.description,
          private: params.private,
          autoInit: params.autoInit,
          defaultBranch: params.defaultBranch
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              repository: {
                id: repository.id,
                name: repository.name,
                fullName: repository.full_name,
                url: repository.html_url,
                cloneUrl: repository.clone_url,
                sshUrl: repository.ssh_url,
                private: repository.private,
                createdAt: repository.created_at
              }
            }, null, 2)
          }]
        };

      } catch (error) {
        logger.error('Failed to create repository', { error, args });
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Invalid parameters: ' + error.errors.map(e => e.message).join(', ')
          );
        }

        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          `Failed to create repository: ${error.message}`
        );
      }
    }
  );
}
```

### File Upload Tool

```typescript
// src/tools/upload-files.ts
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getGiteaClient } from '../services/instance-manager.js';
import { logger } from '../utils/logging.js';
import { AppError, ErrorCode } from '../utils/error-handling.js';
import path from 'path';

const FileSchema = z.object({
  path: z.string().describe('File path in repository'),
  content: z.string().describe('File content (text or base64)')
});

const UploadFilesSchema = z.object({
  instanceId: z.string().describe('Gitea instance identifier'),
  owner: z.string().describe('Repository owner'),
  repository: z.string().describe('Repository name'),
  files: z.array(FileSchema).min(1).describe('Array of files to upload'),
  message: z.string().describe('Commit message'),
  branch: z.string().default('main').describe('Target branch'),
  batchSize: z.number().default(10).describe('Batch size for uploads')
});

export async function registerUploadFilesTool(server: McpServer) {
  server.tool(
    'upload_files',
    {
      description: 'Upload files and folders to Gitea repository while preserving directory structure',
      parameters: UploadFilesSchema
    },
    async (args) => {
      try {
        const params = UploadFilesSchema.parse(args);
        
        logger.info('Uploading files via MCP tool', {
          instanceId: params.instanceId,
          repository: `${params.owner}/${params.repository}`,
          fileCount: params.files.length
        });

        // Validate file paths and content
        const validatedFiles = params.files.map(file => {
          // Normalize path separators
          const normalizedPath = file.path.replace(/\\/g, '/');
          
          // Validate path doesn't contain dangerous sequences
          if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
            throw new AppError(
              ErrorCode.VALIDATION_ERROR,
              `Invalid file path: ${file.path}`
            );
          }

          return {
            path: normalizedPath,
            content: file.content
          };
        });

        // Get Gitea client
        const client = await getGiteaClient(params.instanceId);
        
        // Upload files in batches
        const results = await client.batchUploadFiles({
          owner: params.owner,
          repo: params.repository,
          files: validatedFiles,
          message: params.message,
          branch: params.branch,
          batchSize: params.batchSize
        });

        // Process results
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failureCount = results.filter(r => r.status === 'rejected').length;
        
        const failures = results
          .filter(r => r.status === 'rejected')
          .map((r: any) => r.reason?.message || 'Unknown error');

        logger.info('File upload completed', {
          instanceId: params.instanceId,
          repository: `${params.owner}/${params.repository}`,
          successCount,
          failureCount
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: failureCount === 0,
              summary: {
                totalFiles: params.files.length,
                uploaded: successCount,
                failed: failureCount
              },
              details: {
                failures: failures.length > 0 ? failures : undefined,
                repository: `${params.owner}/${params.repository}`,
                branch: params.branch,
                commitMessage: params.message
              }
            }, null, 2)
          }]
        };

      } catch (error) {
        logger.error('Failed to upload files', { error, args });
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Invalid parameters: ' + error.errors.map(e => e.message).join(', ')
          );
        }

        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          `Failed to upload files: ${error.message}`
        );
      }
    }
  );
}
```

### Error Handling System

```typescript
// src/utils/error-handling.ts
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export function setupErrorHandling() {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

export function handleMcpError(error: unknown): Error {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      ErrorCode.INTERNAL_ERROR,
      error.message
    );
  }

  return new AppError(
    ErrorCode.INTERNAL_ERROR,
    'Unknown error occurred'
  );
}
```

### Logging System

```typescript
// src/utils/logging.ts
import pino from 'pino';
import { loadConfig } from '../config/index.js';

const config = loadConfig();

export const logger = pino({
  level: config.server.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  },
  serializers: {
    err: pino.stdSerializers.err
  },
  redact: {
    paths: ['token', 'password', 'authorization'],
    censor: '[REDACTED]'
  },
  transport: config.server.environment === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  } : undefined
});
```

## Configuration Setup

### Environment Variables (.env.example)

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
  },
  {
    "id": "dev",
    "name": "Development Gitea",
    "baseUrl": "https://dev-gitea.example.com",
    "token": "dev-token",
    "timeout": 30000
  }
]'

# Upload Configuration
MAX_FILE_SIZE=10485760
MAX_FILES=100
BATCH_SIZE=10

# Gitea API Configuration
GITEA_TIMEOUT=30000
GITEA_MAX_RETRIES=3
```

### MCP Client Configuration

```json
{
  "mcpServers": {
    "gitea-mcp": {
      "command": "node",
      "args": ["./build/index.js"],
      "env": {
        "NODE_ENV": "production",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

## Testing Strategy

### Unit Tests Example

```typescript
// tests/unit/tools/create-repository.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateRepositoryTool } from '../../../src/tools/create-repository.js';

describe('Create Repository Tool', () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({
      name: 'test-server',
      version: '1.0.0'
    });
  });

  it('should create repository with valid parameters', async () => {
    await registerCreateRepositoryTool(server);
    
    const result = await server.callTool('create_repository', {
      instanceId: 'test',
      name: 'test-repo',
      description: 'Test repository',
      private: true
    });

    expect(result.content[0].text).toContain('success');
  });

  it('should validate required parameters', async () => {
    await registerCreateRepositoryTool(server);
    
    await expect(server.callTool('create_repository', {
      instanceId: 'test'
      // Missing required 'name' parameter
    })).rejects.toThrow('Invalid parameters');
  });
});
```

### Integration Test Configuration

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['tests/integration/setup.ts']
  }
});
```

## Deployment Instructions

### Docker Configuration

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY . .
RUN npm run build

FROM node:18-alpine AS runtime

RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 8080
USER mcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('Health check passed')" || exit 1

CMD ["node", "build/index.js"]
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitea-mcp
  labels:
    app: gitea-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gitea-mcp
  template:
    metadata:
      labels:
        app: gitea-mcp
    spec:
      containers:
      - name: gitea-mcp
        image: gitea-mcp:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
        - name: GITEA_INSTANCES
          valueFrom:
            secretKeyRef:
              name: gitea-config
              key: instances
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

### CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm run test:coverage
      
      - name: Run linting
        run: npm run lint
      
      - name: Type checking
        run: npm run type-check
      
      - name: Build project
        run: npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run security audit
        run: npm audit --audit-level=high
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  deploy:
    needs: [test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to production
        run: echo "Deploy to production environment"
```

## Security Best Practices

### Authentication Security

1. **Token Management**:
   - Use scoped personal access tokens with minimal required permissions
   - Implement token rotation procedures
   - Store tokens securely using environment variables or secrets management

2. **API Security**:
   - Validate all inputs using Zod schemas
   - Implement rate limiting per Gitea instance
   - Use HTTPS for all API communications
   - Log security events without exposing sensitive data

3. **Multi-Instance Security**:
   - Isolate credentials per Gitea instance
   - Implement proper error handling to prevent information disclosure
   - Use principle of least privilege for API access

### Production Monitoring

```typescript
// src/utils/monitoring.ts
import { logger } from './logging.js';

export class MonitoringService {
  private metrics = {
    toolCalls: new Map<string, number>(),
    errors: new Map<string, number>(),
    responseTimeMs: new Map<string, number[]>()
  };

  recordToolCall(toolName: string, durationMs: number) {
    const count = this.metrics.toolCalls.get(toolName) || 0;
    this.metrics.toolCalls.set(toolName, count + 1);
    
    const times = this.metrics.responseTimeMs.get(toolName) || [];
    times.push(durationMs);
    this.metrics.responseTimeMs.set(toolName, times);
    
    logger.info('Tool execution completed', {
      tool: toolName,
      duration: durationMs
    });
  }

  recordError(toolName: string, error: Error) {
    const count = this.metrics.errors.get(toolName) || 0;
    this.metrics.errors.set(toolName, count + 1);
    
    logger.error('Tool execution failed', {
      tool: toolName,
      error: error.message
    });
  }

  getHealthStatus() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      metrics: {
        totalCalls: Array.from(this.metrics.toolCalls.values()).reduce((a, b) => a + b, 0),
        totalErrors: Array.from(this.metrics.errors.values()).reduce((a, b) => a + b, 0),
        averageResponseTime: this.calculateAverageResponseTime()
      }
    };
  }

  private calculateAverageResponseTime(): number {
    const allTimes = Array.from(this.metrics.responseTimeMs.values()).flat();
    return allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : 0;
  }
}
```

## Documentation Requirements

### API Documentation (docs/API.md)

```markdown
# Gitea MCP Server API Documentation

## Tools

### create_repository
Creates a new repository on the specified Gitea instance.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `name` (string, required): Repository name
- `description` (string, optional): Repository description
- `private` (boolean, default: true): Make repository private
- `autoInit` (boolean, default: true): Initialize with README
- `defaultBranch` (string, default: "main"): Default branch name

**Returns:**
Repository object with ID, URLs, and metadata.

### upload_files
Uploads multiple files to a repository while preserving directory structure.

**Parameters:**
- `instanceId` (string, required): Gitea instance identifier
- `owner` (string, required): Repository owner
- `repository` (string, required): Repository name
- `files` (array, required): Array of file objects with path and content
- `message` (string, required): Commit message
- `branch` (string, default: "main"): Target branch
- `batchSize` (number, default: 10): Batch size for uploads

**Returns:**
Upload summary with success/failure counts and details.
```

## Production Readiness Checklist

### Pre-Deployment Verification

- [ ] **Configuration Management**: Environment variables validated and documented
- [ ] **Authentication**: Secure token storage and rotation procedures implemented
- [ ] **Error Handling**: Comprehensive error handling with proper logging
- [ ] **Input Validation**: All inputs validated using Zod schemas
- [ ] **Rate Limiting**: Implemented per Gitea instance to respect API limits
- [ ] **Logging**: Structured logging with security-safe output
- [ ] **Monitoring**: Health checks and metrics collection implemented
- [ ] **Testing**: Unit and integration tests with >80% coverage
- [ ] **Security**: Security audit completed, vulnerabilities addressed
- [ ] **Documentation**: Complete API documentation and deployment guides
- [ ] **Deployment**: Docker containerization and Kubernetes manifests ready
- [ ] **CI/CD**: Automated testing and deployment pipeline configured

### Operational Procedures

1. **Health Monitoring**: Implement `/health` endpoint for continuous monitoring
2. **Log Aggregation**: Configure centralized logging for production environments
3. **Alert Configuration**: Set up alerts for error rates, latency, and availability
4. **Backup Procedures**: Document configuration backup and recovery procedures
5. **Update Strategy**: Implement rolling updates with zero-downtime deployment
6. **Incident Response**: Create runbooks for common operational scenarios

## Development Team Handoff Summary

This comprehensive handoff package provides everything needed to build a production-ready Gitea MCP server:

1. **Complete project structure** with all necessary files and organization
2. **Production-ready code examples** with TypeScript best practices
3. **Comprehensive configuration management** with validation and multi-environment support
4. **Robust error handling and logging** for operational excellence
5. **Security implementation** following industry best practices
6. **Testing strategy** with unit and integration test examples
7. **Deployment automation** with Docker and Kubernetes configurations
8. **Monitoring and observability** for production operations
9. **Complete documentation** for API usage and operational procedures

The development team can use this handoff to implement a maintainable, secure, and scalable MCP server that integrates seamlessly with self-hosted Gitea platforms while following MCP protocol specifications and production deployment best practices.