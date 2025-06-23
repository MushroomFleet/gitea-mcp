# Testing Team Handoff: Gitea-MCP

## Overview

This document provides comprehensive testing specifications for the Gitea-MCP TypeScript server. The testing team should implement a robust test suite ensuring reliability, security, and performance of the MCP server.

## Testing Framework Setup

### Required Dependencies

```json
{
  "devDependencies": {
    "vitest": "^1.2.0",
    "@vitest/coverage-v8": "^1.2.0",
    "@vitest/ui": "^1.2.0",
    "supertest": "^6.3.4",
    "nock": "^13.5.0",
    "msw": "^2.0.0",
    "test-containers": "^10.5.0"
  }
}
```

### Test Configuration Files

**vitest.config.ts**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'build/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*'
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    setupFiles: ['tests/setup.ts'],
    testTimeout: 10000
  }
});
```

**vitest.integration.config.ts**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: 30000,
    maxConcurrency: 1 // Prevent conflicts with external APIs
  }
});
```

## Test Structure

### Directory Organization

```
tests/
├── setup.ts                          # Global test setup
├── fixtures/                         # Test data and mocks
│   ├── gitea-responses.json          # Mock Gitea API responses
│   ├── mcp-requests.json             # Sample MCP requests
│   └── test-files/                   # Sample files for upload tests
├── unit/                             # Unit tests
│   ├── config/
│   │   ├── index.test.ts             # Configuration loading tests
│   │   └── validation.test.ts        # Config validation tests
│   ├── gitea/
│   │   ├── client.test.ts            # Gitea client tests
│   │   ├── auth.test.ts              # Authentication tests
│   │   └── utils.test.ts             # Utility function tests
│   ├── tools/
│   │   ├── create-repository.test.ts # Repository creation tool tests
│   │   ├── upload-files.test.ts      # File upload tool tests
│   │   └── schemas.test.ts           # Schema validation tests
│   ├── services/
│   │   ├── repository.test.ts        # Repository service tests
│   │   ├── file-upload.test.ts       # File upload service tests
│   │   └── instance-manager.test.ts  # Instance manager tests
│   └── utils/
│       ├── error-handling.test.ts    # Error handling tests
│       ├── validation.test.ts        # Input validation tests
│       ├── logging.test.ts           # Logging tests
│       ├── monitoring.test.ts        # Monitoring tests
│       └── retry.test.ts             # Retry logic tests
├── integration/                      # Integration tests
│   ├── setup.ts                      # Integration test setup
│   ├── mcp-server.test.ts           # Full MCP server tests
│   ├── gitea-api.test.ts            # Real Gitea API integration
│   └── end-to-end.test.ts           # Complete workflow tests
└── performance/                      # Performance tests
    ├── load-testing.test.ts         # Load testing scenarios
    └── stress-testing.test.ts       # Stress testing scenarios
```

## Unit Testing Specifications

### 1. Configuration Tests

**tests/unit/config/index.test.ts**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../../src/config/index.js';

describe('Configuration Loading', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load valid configuration', () => {
    process.env.GITEA_INSTANCES = JSON.stringify([{
      id: 'test',
      name: 'Test Instance',
      baseUrl: 'https://gitea.test.com',
      token: 'test-token'
    }]);

    const config = loadConfig();
    expect(config.gitea.instances).toHaveLength(1);
    expect(config.gitea.instances[0].id).toBe('test');
  });

  it('should throw error for invalid configuration', () => {
    process.env.GITEA_INSTANCES = 'invalid-json';
    expect(() => loadConfig()).toThrow();
  });

  it('should use default values for optional fields', () => {
    process.env.GITEA_INSTANCES = JSON.stringify([{
      id: 'test',
      name: 'Test Instance',
      baseUrl: 'https://gitea.test.com',
      token: 'test-token'
    }]);

    const config = loadConfig();
    expect(config.gitea.instances[0].timeout).toBe(30000);
    expect(config.upload.maxFileSize).toBe(10485760);
  });
});
```

### 2. Gitea Client Tests

**tests/unit/gitea/client.test.ts**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import nock from 'nock';
import { GiteaClient } from '../../../src/gitea/client.js';

describe('GiteaClient', () => {
  let client: GiteaClient;
  const mockInstance = {
    id: 'test',
    name: 'Test Gitea',
    baseUrl: 'https://gitea.test.com',
    token: 'test-token',
    timeout: 30000,
    rateLimit: { requests: 100, windowMs: 60000 }
  };

  beforeEach(() => {
    client = new GiteaClient(mockInstance);
    nock.cleanAll();
  });

  describe('createRepository', () => {
    it('should create repository successfully', async () => {
      const mockResponse = {
        id: 123,
        name: 'test-repo',
        full_name: 'testuser/test-repo',
        html_url: 'https://gitea.test.com/testuser/test-repo',
        clone_url: 'https://gitea.test.com/testuser/test-repo.git',
        ssh_url: 'git@gitea.test.com:testuser/test-repo.git',
        private: true,
        created_at: '2023-01-01T00:00:00Z'
      };

      nock('https://gitea.test.com')
        .post('/api/v1/user/repos')
        .reply(201, mockResponse);

      const result = await client.createRepository({
        name: 'test-repo',
        description: 'Test repository',
        private: true
      });

      expect(result.name).toBe('test-repo');
      expect(result.private).toBe(true);
    });

    it('should handle authentication errors', async () => {
      nock('https://gitea.test.com')
        .post('/api/v1/user/repos')
        .reply(401, { message: 'Unauthorized' });

      await expect(client.createRepository({
        name: 'test-repo'
      })).rejects.toThrow('Authentication failed');
    });

    it('should handle rate limiting', async () => {
      nock('https://gitea.test.com')
        .post('/api/v1/user/repos')
        .reply(429, { message: 'Too Many Requests' });

      await expect(client.createRepository({
        name: 'test-repo'
      })).rejects.toThrow();
    });
  });

  describe('uploadFile', () => {
    it('should upload file successfully', async () => {
      const mockResponse = {
        content: { sha: 'abc123' },
        commit: { sha: 'def456' }
      };

      nock('https://gitea.test.com')
        .put('/api/v1/repos/testuser/test-repo/contents/test.txt')
        .reply(201, mockResponse);

      const result = await client.uploadFile({
        owner: 'testuser',
        repo: 'test-repo',
        path: 'test.txt',
        content: 'Hello, World!',
        message: 'Add test file'
      });

      expect(result.content.sha).toBe('abc123');
    });

    it('should handle file conflicts', async () => {
      nock('https://gitea.test.com')
        .put('/api/v1/repos/testuser/test-repo/contents/test.txt')
        .reply(409, { message: 'Conflict' });

      await expect(client.uploadFile({
        owner: 'testuser',
        repo: 'test-repo',
        path: 'test.txt',
        content: 'Hello, World!',
        message: 'Add test file'
      })).rejects.toThrow();
    });
  });

  describe('batchUploadFiles', () => {
    it('should upload multiple files in batches', async () => {
      const files = [
        { path: 'file1.txt', content: 'Content 1' },
        { path: 'file2.txt', content: 'Content 2' }
      ];

      nock('https://gitea.test.com')
        .put('/api/v1/repos/testuser/test-repo/contents/file1.txt')
        .reply(201, { content: { sha: 'abc123' } })
        .put('/api/v1/repos/testuser/test-repo/contents/file2.txt')
        .reply(201, { content: { sha: 'def456' } });

      const results = await client.batchUploadFiles({
        owner: 'testuser',
        repo: 'test-repo',
        files,
        message: 'Upload files',
        batchSize: 2
      });

      expect(results).toHaveLength(2);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    });
  });
});
```

### 3. Tool Tests

**tests/unit/tools/create-repository.test.ts**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCreateRepositoryTool } from '../../../src/tools/create-repository.js';

// Mock the instance manager
vi.mock('../../../src/services/instance-manager.js', () => ({
  getGiteaClient: vi.fn()
}));

describe('Create Repository Tool', () => {
  let server: McpServer;
  let mockClient: any;

  beforeEach(() => {
    server = new McpServer({
      name: 'test-server',
      version: '1.0.0'
    });

    mockClient = {
      createRepository: vi.fn()
    };

    vi.mocked(getGiteaClient).mockResolvedValue(mockClient);
  });

  it('should register tool with correct schema', async () => {
    await registerCreateRepositoryTool(server);
    
    const tools = server.listTools();
    expect(tools).toContain('create_repository');
  });

  it('should create repository with valid parameters', async () => {
    mockClient.createRepository.mockResolvedValue({
      id: 123,
      name: 'test-repo',
      full_name: 'user/test-repo',
      html_url: 'https://gitea.test.com/user/test-repo',
      clone_url: 'https://gitea.test.com/user/test-repo.git',
      ssh_url: 'git@gitea.test.com:user/test-repo.git',
      private: true,
      created_at: '2023-01-01T00:00:00Z'
    });

    await registerCreateRepositoryTool(server);
    
    const result = await server.callTool('create_repository', {
      instanceId: 'test',
      name: 'test-repo',
      description: 'Test repository',
      private: true
    });

    expect(mockClient.createRepository).toHaveBeenCalledWith({
      name: 'test-repo',
      description: 'Test repository',
      private: true,
      autoInit: true,
      defaultBranch: 'main'
    });

    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(response.repository.name).toBe('test-repo');
  });

  it('should validate required parameters', async () => {
    await registerCreateRepositoryTool(server);
    
    await expect(server.callTool('create_repository', {
      instanceId: 'test'
      // Missing required 'name' parameter
    })).rejects.toThrow('Invalid parameters');
  });

  it('should handle API errors gracefully', async () => {
    mockClient.createRepository.mockRejectedValue(
      new Error('Repository already exists')
    );

    await registerCreateRepositoryTool(server);
    
    await expect(server.callTool('create_repository', {
      instanceId: 'test',
      name: 'existing-repo'
    })).rejects.toThrow('Failed to create repository');
  });
});
```

## Integration Testing Specifications

### 1. MCP Server Integration Tests

**tests/integration/mcp-server.test.ts**
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('MCP Server Integration', () => {
  let serverProcess: ChildProcess;
  let client: McpClient;

  beforeAll(async () => {
    // Start the MCP server
    serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set up client
    client = new McpClient({
      name: 'test-client',
      version: '1.0.0'
    });

    const transport = new StdioClientTransport({
      spawn: {
        command: 'node',
        args: ['build/index.js']
      }
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    serverProcess?.kill();
  });

  it('should initialize and list tools', async () => {
    const tools = await client.listTools();
    
    expect(tools.tools).toContainEqual(
      expect.objectContaining({
        name: 'create_repository'
      })
    );

    expect(tools.tools).toContainEqual(
      expect.objectContaining({
        name: 'upload_files'
      })
    );
  });

  it('should handle create_repository tool call', async () => {
    const result = await client.callTool({
      name: 'create_repository',
      arguments: {
        instanceId: 'test',
        name: 'integration-test-repo',
        description: 'Integration test repository',
        private: true
      }
    });

    expect(result.content[0]).toHaveProperty('text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toHaveProperty('success');
  });
});
```

### 2. End-to-End Workflow Tests

**tests/integration/end-to-end.test.ts**
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContainer } from 'testcontainers';
import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';

describe('End-to-End Workflows', () => {
  let giteaContainer: any;
  let client: McpClient;

  beforeAll(async () => {
    // Start Gitea container for testing
    giteaContainer = await new TestContainer('gitea/gitea:latest')
      .withExposedPorts(3000)
      .withEnvironmentVariables({
        'GITEA__security__INSTALL_LOCK': 'true',
        'GITEA__security__SECRET_KEY': 'test-secret-key'
      })
      .start();

    // Configure test environment
    process.env.GITEA_INSTANCES = JSON.stringify([{
      id: 'test',
      name: 'Test Gitea',
      baseUrl: `http://localhost:${giteaContainer.getMappedPort(3000)}`,
      token: 'test-token'
    }]);

    // Initialize MCP client
    // ... setup code
  }, 60000);

  afterAll(async () => {
    await giteaContainer?.stop();
    await client?.close();
  });

  it('should complete full repository creation and file upload workflow', async () => {
    // Step 1: Create repository
    const createResult = await client.callTool({
      name: 'create_repository',
      arguments: {
        instanceId: 'test',
        name: 'e2e-test-repo',
        description: 'End-to-end test repository'
      }
    });

    const createResponse = JSON.parse(createResult.content[0].text);
    expect(createResponse.success).toBe(true);

    // Step 2: Upload files
    const uploadResult = await client.callTool({
      name: 'upload_files',
      arguments: {
        instanceId: 'test',
        owner: 'testuser',
        repository: 'e2e-test-repo',
        files: [
          {
            path: 'README.md',
            content: '# E2E Test Repository\n\nThis is a test.'
          },
          {
            path: 'src/index.js',
            content: 'console.log("Hello, World!");'
          }
        ],
        message: 'Initial commit with files'
      }
    });

    const uploadResponse = JSON.parse(uploadResult.content[0].text);
    expect(uploadResponse.success).toBe(true);
    expect(uploadResponse.summary.uploaded).toBe(2);
  });
});
```

## Performance Testing

### Load Testing Specifications

**tests/performance/load-testing.test.ts**
```typescript
import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';

describe('Performance Tests', () => {
  it('should handle multiple concurrent repository creations', async () => {
    const startTime = performance.now();
    const concurrentRequests = 10;
    
    const promises = Array.from({ length: concurrentRequests }, (_, i) =>
      client.callTool({
        name: 'create_repository',
        arguments: {
          instanceId: 'test',
          name: `load-test-repo-${i}`,
          description: `Load test repository ${i}`
        }
      })
    );

    const results = await Promise.allSettled(promises);
    const endTime = performance.now();
    
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const duration = endTime - startTime;
    
    expect(successCount).toBeGreaterThanOrEqual(concurrentRequests * 0.8); // 80% success rate
    expect(duration).toBeLessThan(30000); // Complete within 30 seconds
  });

  it('should handle large file uploads efficiently', async () => {
    const largeContent = 'A'.repeat(1024 * 1024); // 1MB file
    const startTime = performance.now();
    
    const result = await client.callTool({
      name: 'upload_files',
      arguments: {
        instanceId: 'test',
        owner: 'testuser',
        repository: 'perf-test-repo',
        files: [
          {
            path: 'large-file.txt',
            content: largeContent
          }
        ],
        message: 'Upload large file'
      }
    });

    const endTime = performance.now();
    const duration = endTime - startTime;
    
    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(duration).toBeLessThan(10000); // Complete within 10 seconds
  });
});
```

## Quality Gates and Coverage Requirements

### Minimum Coverage Thresholds

- **Line Coverage**: 80%
- **Branch Coverage**: 80%
- **Function Coverage**: 80%
- **Statement Coverage**: 80%

### Quality Checks

1. **Code Quality**
   - ESLint compliance with zero errors
   - Prettier formatting compliance
   - TypeScript strict mode compliance

2. **Security**
   - npm audit with no high/critical vulnerabilities
   - No hardcoded secrets or tokens
   - Proper input validation coverage

3. **Performance**
   - Response times under acceptable thresholds
   - Memory usage within limits
   - No memory leaks in long-running tests

## Test Data Management

### Fixtures and Mocks

**tests/fixtures/gitea-responses.json**
```json
{
  "createRepository": {
    "success": {
      "id": 123,
      "name": "test-repo",
      "full_name": "user/test-repo",
      "html_url": "https://gitea.test.com/user/test-repo",
      "clone_url": "https://gitea.test.com/user/test-repo.git",
      "ssh_url": "git@gitea.test.com:user/test-repo.git",
      "private": true,
      "created_at": "2023-01-01T00:00:00Z"
    },
    "conflict": {
      "message": "Repository already exists"
    },
    "unauthorized": {
      "message": "Unauthorized"
    }
  },
  "uploadFile": {
    "success": {
      "content": { "sha": "abc123" },
      "commit": { "sha": "def456" }
    },
    "conflict": {
      "message": "File already exists"
    }
  }
}
```

### Test Environment Setup

**tests/setup.ts**
```typescript
import { vi } from 'vitest';
import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock external dependencies
vi.mock('cross-fetch', () => ({
  default: vi.fn()
}));

// Global test setup
beforeEach(() => {
  vi.clearAllMocks();
});

// Global test teardown
afterEach(() => {
  vi.restoreAllMocks();
});
```

## Continuous Integration Integration

### GitHub Actions Test Workflow

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:coverage
      
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      gitea:
        image: gitea/gitea:latest
        ports:
          - 3000:3000
        env:
          GITEA__security__INSTALL_LOCK: true
          GITEA__security__SECRET_KEY: test-secret-key
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build project
        run: npm run build
      
      - name: Run integration tests
        run: npm run test:integration
```

## Testing Team Deliverables

1. **Complete Test Suite Implementation**
   - All unit tests for every component
   - Integration tests for MCP functionality
   - End-to-end workflow tests
   - Performance and load tests

2. **Test Infrastructure**
   - Test configuration and setup
   - Mock services and fixtures
   - CI/CD integration
   - Coverage reporting

3. **Quality Assurance**
   - Automated quality gates
   - Security testing integration
   - Performance benchmarking
   - Test documentation

4. **Monitoring and Reporting**
   - Test result dashboards
   - Coverage trend analysis
   - Performance regression detection
   - Quality metrics tracking

The testing team should ensure comprehensive coverage of all functionality while maintaining fast test execution and reliable results in CI/CD environments.
