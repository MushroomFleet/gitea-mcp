#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { setupErrorHandling } from "./utils/error-handling.js";
import { logger } from "./utils/logging.js";
import { validateConfig } from "./config/validation.js";
import { loadConfig } from './config/index.js';
import { registerSyncUpdateTool } from './tools/sync-update.js';
import ignore from 'ignore';
import * as fs from 'fs/promises';
import * as path from 'path';

class GiteaMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server({
      name: "gitea-mcp",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {},
      },
    });

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => {
      logger.error('[MCP Error]', error);
    };
  }

  private setupToolHandlers() {
    // Register available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_repository',
          description: 'Create a new repository on Gitea instance',
          inputSchema: {
            type: 'object',
            properties: {
              instanceId: {
                type: 'string',
                description: 'Gitea instance identifier'
              },
              name: {
                type: 'string',
                description: 'Repository name'
              },
              description: {
                type: 'string',
                description: 'Repository description'
              },
              private: {
                type: 'boolean',
                description: 'Make repository private'
              },
              autoInit: {
                type: 'boolean',
                description: 'Initialize with README'
              },
              defaultBranch: {
                type: 'string',
                description: 'Default branch name'
              }
            },
            required: ['instanceId', 'name']
          }
        },
        {
          name: 'upload_files',
          description: 'Upload files to Gitea repository',
          inputSchema: {
            type: 'object',
            properties: {
              instanceId: {
                type: 'string',
                description: 'Gitea instance identifier'
              },
              owner: {
                type: 'string',
                description: 'Repository owner'
              },
              repository: {
                type: 'string',
                description: 'Repository name'
              },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'string',
                      description: 'File path in repository'
                    },
                    content: {
                      type: 'string',
                      description: 'File content (text or base64)'
                    }
                  },
                  required: ['path', 'content']
                },
                description: 'Array of files to upload'
              },
              message: {
                type: 'string',
                description: 'Commit message'
              },
              branch: {
                type: 'string',
                description: 'Target branch'
              }
            },
            required: ['instanceId', 'owner', 'repository', 'files', 'message']
          }
        },
        {
          name: 'sync_project',
          description: 'Sync entire project to Gitea repository while respecting .gitignore rules',
          inputSchema: {
            type: 'object',
            properties: {
              instanceId: {
                type: 'string',
                description: 'Gitea instance identifier'
              },
              owner: {
                type: 'string',
                description: 'Repository owner'
              },
              repository: {
                type: 'string',
                description: 'Repository name'
              },
              message: {
                type: 'string',
                description: 'Commit message'
              },
              branch: {
                type: 'string',
                description: 'Target branch'
              },
              projectPath: {
                type: 'string',
                description: 'Path to project directory'
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview what would be uploaded without actually uploading'
              },
              includeHidden: {
                type: 'boolean',
                description: 'Include hidden files (starting with .)'
              },
              maxFileSize: {
                type: 'number',
                description: 'Maximum file size in bytes'
              },
              textOnly: {
                type: 'boolean',
                description: 'Only upload text files (skip binary files)'
              }
            },
            required: ['instanceId', 'owner', 'repository', 'message']
          }
        },
        {
          name: 'sync_update',
          description: 'Advanced tool for updating existing files in Gitea repository with conflict resolution',
          inputSchema: {
            type: 'object',
            properties: {
              instanceId: {
                type: 'string',
                description: 'Gitea instance identifier'
              },
              owner: {
                type: 'string',
                description: 'Repository owner'
              },
              repository: {
                type: 'string',
                description: 'Repository name'
              },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: {
                      type: 'string',
                      description: 'File path in repository'
                    },
                    content: {
                      type: 'string',
                      description: 'File content (text, required for add/modify operations)'
                    },
                    operation: {
                      type: 'string',
                      enum: ['add', 'modify', 'delete'],
                      description: 'Operation to perform: add (create new), modify (update existing), delete (remove)'
                    },
                    sha: {
                      type: 'string',
                      description: 'Current file SHA (required for modify/delete operations, auto-detected if not provided)'
                    }
                  },
                  required: ['path', 'operation']
                },
                minItems: 1,
                description: 'Array of file operations to perform'
              },
              message: {
                type: 'string',
                description: 'Commit message'
              },
              branch: {
                type: 'string',
                description: 'Target branch'
              },
              strategy: {
                type: 'string',
                enum: ['auto', 'batch', 'individual'],
                description: 'Update strategy: auto (choose best), batch (single commit), individual (separate commits)'
              },
              conflictResolution: {
                type: 'string',
                enum: ['fail', 'overwrite', 'skip'],
                description: 'How to handle conflicts when remote files have changed'
              },
              detectChanges: {
                type: 'boolean',
                description: 'Compare with remote files to avoid unnecessary updates'
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview operations without making changes'
              }
            },
            required: ['instanceId', 'owner', 'repository', 'files', 'message']
          }
        }
      ]
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'create_repository') {
        return await this.handleCreateRepository(args);
      } else if (name === 'upload_files') {
        return await this.handleUploadFiles(args);
      } else if (name === 'sync_project') {
        return await this.handleSyncProject(args);
      } else if (name === 'sync_update') {
        return await this.handleSyncUpdate(args);
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }
    });
  }

  private async handleCreateRepository(args: any) {
    try {
      logger.debug('Creating repository', { args });

      // Get configuration
      const config = loadConfig();
      const instance = config.gitea.instances.find(inst => inst.id === args.instanceId);
      
      if (!instance) {
        throw new McpError(ErrorCode.InvalidParams, `Gitea instance '${args.instanceId}' not found`);
      }

      // Prepare request body
      const requestBody = {
        name: args.name,
        description: args.description || '',
        private: args.private !== undefined ? args.private : false,
        auto_init: args.autoInit !== undefined ? args.autoInit : true,
        default_branch: args.defaultBranch || 'main'
      };

      // Make API call
      const response = await fetch(`${instance.baseUrl}/api/v1/user/repos`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `token ${instance.token}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{
            type: 'text',
            text: `Failed to create repository: ${response.status} ${response.statusText} - ${errorText}`
          }],
          isError: true
        };
      }

      const repository = await response.json();

      logger.info('Repository created successfully', {
        instanceId: args.instanceId,
        repository: repository.name,
        id: repository.id
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
              private: repository.private,
              createdAt: repository.created_at
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      logger.error('Failed to create repository', { error, args });
      return {
        content: [{
          type: 'text',
          text: `Error creating repository: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }

  private async handleUploadFiles(args: any) {
    try {
      logger.debug('Uploading files', { args });

      // Get configuration
      const config = loadConfig();
      const instance = config.gitea.instances.find(inst => inst.id === args.instanceId);
      
      if (!instance) {
        throw new McpError(ErrorCode.InvalidParams, `Gitea instance '${args.instanceId}' not found`);
      }

      const results = [];
      const branch = args.branch || 'main';

      // Upload each file
      for (const file of args.files) {
        try {
          // Convert content to base64
          const base64Content = Buffer.from(file.content, 'utf8').toString('base64');
          
          const requestBody = {
            content: base64Content,
            message: args.message,
            branch: branch
          };

          const response = await fetch(`${instance.baseUrl}/api/v1/repos/${args.owner}/${args.repository}/contents/${file.path}`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': `token ${instance.token}`
            },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            results.push({ file: file.path, status: 'success' });
          } else {
            const errorText = await response.text();
            results.push({ file: file.path, status: 'failed', error: `${response.status}: ${errorText}` });
          }
        } catch (error) {
          results.push({ file: file.path, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      const successCount = results.filter(r => r.status === 'success').length;
      const failureCount = results.filter(r => r.status === 'failed').length;

      logger.info('File upload completed', {
        instanceId: args.instanceId,
        repository: `${args.owner}/${args.repository}`,
        successCount,
        failureCount
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: failureCount === 0,
            summary: {
              totalFiles: args.files.length,
              uploaded: successCount,
              failed: failureCount
            },
            results: results
          }, null, 2)
        }]
      };

    } catch (error) {
      logger.error('Failed to upload files', { error, args });
      return {
        content: [{
          type: 'text',
          text: `Error uploading files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }

  private async handleSyncProject(args: any) {
    try {
      logger.debug('Syncing project', { args });

      // Manual parameter validation and defaults
      const params = {
        instanceId: args.instanceId,
        owner: args.owner,
        repository: args.repository,
        message: args.message,
        branch: args.branch || 'main',
        projectPath: args.projectPath || '.',
        dryRun: args.dryRun || false,
        includeHidden: args.includeHidden || false,
        maxFileSize: args.maxFileSize || 1048576, // 1MB
        textOnly: args.textOnly !== undefined ? args.textOnly : true
      };

      // Get configuration and find the instance
      const config = loadConfig();
      const instance = config.gitea.instances.find(inst => inst.id === params.instanceId);
      
      if (!instance) {
        throw new McpError(ErrorCode.InvalidParams, `Gitea instance '${params.instanceId}' not found`);
      }

      logger.info('Syncing project via MCP tool', {
        instanceId: params.instanceId,
        repository: `${params.owner}/${params.repository}`,
        projectPath: params.projectPath,
        dryRun: params.dryRun
      });

      // Discover and filter files
      const files = await this.discoverProjectFiles(params.projectPath, {
        includeHidden: params.includeHidden,
        maxFileSize: params.maxFileSize,
        textOnly: params.textOnly
      });

      const result = {
        discovered: files.length,
        filtered: 0,
        uploaded: 0,
        failed: 0,
        skipped: 0,
        details: {
          uploaded: [] as string[],
          failed: [] as Array<{ file: string; error: string }>,
          skipped: [] as Array<{ file: string; reason: string }>
        }
      };

      if (params.dryRun) {
        // Dry run - just report what would be uploaded
        result.filtered = files.length;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              dryRun: true,
              summary: result,
              files: files.map(f => ({
                path: f.path,
                size: f.size,
                isText: f.isText
              }))
            }, null, 2)
          }]
        };
      }

      // Upload files
      for (const file of files) {
        try {
          // Convert content to base64
          const base64Content = Buffer.from(file.content, 'utf8').toString('base64');
          
          const requestBody = {
            content: base64Content,
            message: params.message,
            branch: params.branch
          };

          const response = await fetch(`${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents/${file.path}`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': `token ${instance.token}`
            },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            result.uploaded++;
            result.details.uploaded.push(file.path);
          } else {
            const errorText = await response.text();
            result.failed++;
            result.details.failed.push({ 
              file: file.path, 
              error: `${response.status}: ${errorText}` 
            });
          }
        } catch (error) {
          result.failed++;
          result.details.failed.push({ 
            file: file.path, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }

      logger.info('Project sync completed', {
        instanceId: params.instanceId,
        repository: `${params.owner}/${params.repository}`,
        ...result
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.failed === 0,
            summary: result,
            details: {
              repository: `${params.owner}/${params.repository}`,
              branch: params.branch,
              commitMessage: params.message,
              failures: result.details.failed.length > 0 ? result.details.failed : undefined
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      logger.error('Failed to sync project', { error, args });
      return {
        content: [{
          type: 'text',
          text: `Error syncing project: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }

  private async handleSyncUpdate(args: any) {
    try {
      logger.debug('Sync updating files', { args });

      // Parameter validation and defaults
      const params = {
        instanceId: args.instanceId,
        owner: args.owner,
        repository: args.repository,
        files: args.files || [],
        message: args.message,
        branch: args.branch || 'main',
        strategy: args.strategy || 'auto',
        conflictResolution: args.conflictResolution || 'fail',
        detectChanges: args.detectChanges !== false,
        dryRun: args.dryRun || false
      };

      // Basic validation
      if (!params.instanceId) {
        throw new Error('instanceId is required');
      }
      if (!params.owner) {
        throw new Error('owner is required');
      }
      if (!params.repository) {
        throw new Error('repository is required');
      }
      if (!params.message) {
        throw new Error('message is required');
      }
      if (!Array.isArray(params.files) || params.files.length === 0) {
        throw new Error('files array is required and must not be empty');
      }

      // Get configuration and find the instance
      const config = loadConfig();
      const instance = config.gitea.instances.find(inst => inst.id === params.instanceId);
      
      if (!instance) {
        throw new McpError(ErrorCode.InvalidParams, `Gitea instance '${params.instanceId}' not found`);
      }

      logger.info('Starting sync_update operation', {
        instanceId: params.instanceId,
        repository: `${params.owner}/${params.repository}`,
        fileCount: params.files.length,
        strategy: params.strategy,
        dryRun: params.dryRun
      });

      // Validate and normalize file operations
      const normalizedFiles = this.validateAndNormalizeFiles(params.files);

      // Detect what files need updating by comparing with remote
      const { needsUpdate, remoteFiles } = params.detectChanges 
        ? await this.detectChangesNeeded(instance, params, normalizedFiles)
        : { needsUpdate: normalizedFiles, remoteFiles: new Map() };

      // Determine strategy
      const strategy = this.determineStrategy(params.strategy, needsUpdate);

      const result = {
        discovered: params.files.length,
        analyzed: normalizedFiles.length,
        needsUpdate: needsUpdate.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        details: {
          operations: [] as Array<{ file: string; operation: string; status: string; error?: string }>,
          conflicts: [] as Array<{ file: string; reason: string }>,
          unchanged: [] as string[]
        }
      };

      if (params.dryRun) {
        // Dry run - just report what would be done
        result.details.operations = needsUpdate.map(file => ({
          file: file.path,
          operation: file.operation,
          status: 'would-execute'
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              dryRun: true,
              strategy,
              summary: result,
              filesNeedingUpdate: needsUpdate.map(f => ({
                path: f.path,
                operation: f.operation,
                hasRemoteSha: !!f.sha
              }))
            }, null, 2)
          }]
        };
      }

      // Execute updates based on strategy
      if (strategy === 'batch' && needsUpdate.length > 1) {
        await this.executeBatchUpdate(instance, params, needsUpdate, result);
      } else {
        await this.executeIndividualUpdates(instance, params, needsUpdate, result);
      }

      const success = result.failed === 0;

      logger.info('Sync update completed', {
        instanceId: params.instanceId,
        repository: `${params.owner}/${params.repository}`,
        ...result
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success,
            strategy,
            summary: result,
            details: {
              repository: `${params.owner}/${params.repository}`,
              branch: params.branch,
              commitMessage: params.message,
              operations: result.details.operations,
              conflicts: result.details.conflicts.length > 0 ? result.details.conflicts : undefined,
              unchanged: result.details.unchanged.length > 0 ? result.details.unchanged : undefined
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      logger.error('Failed to sync update files', { error, args });
      return {
        content: [{
          type: 'text',
          text: `Error sync updating files: ${error instanceof Error ? error.message : 'Unknown error'}`
        }],
        isError: true
      };
    }
  }

  private async discoverProjectFiles(
    projectPath: string, 
    options: {
      includeHidden: boolean;
      maxFileSize: number;
      textOnly: boolean;
    }
  ): Promise<Array<{ path: string; content: string; size: number; isText: boolean }>> {
    const files: Array<{ path: string; content: string; size: number; isText: boolean }> = [];
    
    // Load gitignore rules
    const ig = ignore();
    
    try {
      const gitignorePath = path.join(projectPath, '.gitignore');
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
      ig.add(gitignoreContent);
    } catch (error) {
      // .gitignore doesn't exist or can't be read, continue without it
      logger.debug('No .gitignore found or could not read it', { error });
    }

    // Add some sensible defaults if no .gitignore exists
    ig.add([
      'node_modules/',
      '.git/',
      '.env',
      '*.log',
      '.DS_Store',
      'Thumbs.db',
      'build/',
      'dist/',
      'coverage/',
      '.nyc_output/'
    ]);

    const walkDirectory = async (dirPath: string, relativePath = ''): Promise<void> => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        
        // Skip hidden files if not included
        if (!options.includeHidden && entry.name.startsWith('.')) {
          continue;
        }
        
        // Check if ignored by gitignore
        if (ig.ignores(relativeFilePath)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await walkDirectory(fullPath, relativeFilePath);
        } else if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            
            // Skip files that are too large
            if (stats.size > options.maxFileSize) {
              continue;
            }
            
            // Read file content
            const content = await fs.readFile(fullPath, 'utf8');
            
            // Check if it's a text file (simple heuristic)
            const isText = this.isTextFile(content);
            
            // Skip binary files if textOnly is true
            if (options.textOnly && !isText) {
              continue;
            }
            
            files.push({
              path: relativeFilePath.replace(/\\/g, '/'), // Normalize path separators
              content,
              size: stats.size,
              isText
            });
            
          } catch (error) {
            // Skip files that can't be read
            logger.debug('Could not read file', { file: fullPath, error });
            continue;
          }
        }
      }
    };
    
    await walkDirectory(path.resolve(projectPath));
    return files;
  }

  private isTextFile(content: string): boolean {
    // Simple heuristic to determine if a file is text
    // Check for null bytes which are common in binary files
    return !content.includes('\0');
  }

  // Sync update helper methods
  private validateAndNormalizeFiles(files: any[]): any[] {
    return files.map(file => {
      if (!file.path) {
        throw new Error('File path is required');
      }

      const operation = file.operation || 'add';
      
      if (!['add', 'modify', 'delete'].includes(operation)) {
        throw new Error(`Invalid operation: ${operation}. Must be add, modify, or delete`);
      }

      if ((operation === 'add' || operation === 'modify') && !file.content) {
        throw new Error(`Content is required for ${operation} operation on file: ${file.path}`);
      }

      // Normalize path separators
      const normalizedPath = file.path.replace(/\\/g, '/');
      
      // Validate path doesn't contain dangerous sequences
      if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
        throw new Error(`Invalid file path: ${file.path}`);
      }

      return {
        path: normalizedPath,
        content: file.content,
        operation: operation as 'add' | 'modify' | 'delete',
        sha: file.sha
      };
    });
  }

  private async detectChangesNeeded(
    instance: any, 
    params: any, 
    files: any[]
  ): Promise<{ needsUpdate: any[], remoteFiles: Map<string, any> }> {
    const remoteFiles = new Map<string, any>();
    const needsUpdate: any[] = [];

    for (const file of files) {
      try {
        // Get current file info from remote
        const response = await fetch(`${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents/${file.path}?ref=${params.branch}`, {
          headers: {
            'Accept': 'application/json',
            'Authorization': `token ${instance.token}`
          }
        });

        if (response.ok) {
          const remoteFile = await response.json();
          const remoteContent = Buffer.from(remoteFile.content, 'base64').toString('utf8');
          
          remoteFiles.set(file.path, {
            sha: remoteFile.sha,
            content: remoteContent,
            path: file.path
          });

          // Auto-populate SHA for modify/delete operations
          if (file.operation === 'modify' || file.operation === 'delete') {
            file.sha = remoteFile.sha;
          }

          // Check if file actually needs updating
          if (file.operation === 'modify' && file.content === remoteContent) {
            // Content is identical, skip this file
            continue;
          }

          needsUpdate.push(file);
        } else if (response.status === 404) {
          // File doesn't exist remotely
          if (file.operation === 'add') {
            needsUpdate.push(file);
          } else if (file.operation === 'modify') {
            // Convert modify to add since file doesn't exist
            file.operation = 'add';
            delete file.sha;
            needsUpdate.push(file);
          }
          // delete operation on non-existent file is a no-op (already succeeded)
        } else {
          throw new Error(`Failed to check remote file ${file.path}: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        logger.warn('Could not check remote file, will attempt operation anyway', { 
          file: file.path, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        needsUpdate.push(file);
      }
    }

    return { needsUpdate, remoteFiles };
  }

  private determineStrategy(requestedStrategy: string, files: any[]): string {
    if (requestedStrategy !== 'auto') {
      return requestedStrategy;
    }

    // Auto-strategy logic
    if (files.length === 1) {
      return 'individual';
    }
    
    // Use batch for multiple files if all are simple operations
    const hasComplexOperations = files.some(f => f.operation === 'delete');
    return hasComplexOperations ? 'individual' : 'batch';
  }

  private async executeBatchUpdate(
    instance: any,
    params: any,
    files: any[],
    result: any
  ): Promise<void> {
    try {
      // Prepare batch update payload
      const batchFiles = files.map(file => {
        const fileOp: any = {
          path: file.path
        };

        if (file.operation === 'delete') {
          fileOp.operation = 'delete';
          if (file.sha) {
            fileOp.sha = file.sha;
          }
        } else {
          // add or modify
          fileOp.operation = file.operation === 'modify' ? 'update' : 'create';
          fileOp.content = Buffer.from(file.content || '', 'utf8').toString('base64');
          if (file.sha && file.operation === 'modify') {
            fileOp.sha = file.sha;
          }
        }

        return fileOp;
      });

      const requestBody = {
        files: batchFiles,
        message: params.message,
        branch: params.branch
      };

      const response = await fetch(`${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `token ${instance.token}`
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        result.processed = files.length;
        result.succeeded = files.length;
        files.forEach(file => {
          result.details.operations.push({
            file: file.path,
            operation: file.operation,
            status: 'success'
          });
        });
      } else {
        const errorText = await response.text();
        result.processed = files.length;
        result.failed = files.length;
        files.forEach(file => {
          result.details.operations.push({
            file: file.path,
            operation: file.operation,
            status: 'failed',
            error: `Batch operation failed: ${response.status} ${errorText}`
          });
        });
      }
    } catch (error) {
      result.processed = files.length;
      result.failed = files.length;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      files.forEach(file => {
        result.details.operations.push({
          file: file.path,
          operation: file.operation,
          status: 'failed',
          error: `Batch operation error: ${errorMessage}`
        });
      });
    }
  }

  private async executeIndividualUpdates(
    instance: any,
    params: any,
    files: any[],
    result: any
  ): Promise<void> {
    for (const file of files) {
      result.processed++;
      
      try {
        if (file.operation === 'delete') {
          await this.executeDeleteOperation(instance, params, file, result);
        } else {
          await this.executeCreateOrUpdateOperation(instance, params, file, result);
        }
      } catch (error) {
        result.failed++;
        result.details.operations.push({
          file: file.path,
          operation: file.operation,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  private async executeCreateOrUpdateOperation(
    instance: any,
    params: any,
    file: any,
    result: any
  ): Promise<void> {
    const base64Content = Buffer.from(file.content || '', 'utf8').toString('base64');
    
    let url: string;
    let method: string;
    let requestBody: any;

    if (file.operation === 'add') {
      // Create new file
      url = `${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents/${file.path}`;
      method = 'POST';
      requestBody = {
        content: base64Content,
        message: params.message,
        branch: params.branch
      };
    } else {
      // Update existing file
      url = `${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents/${file.path}`;
      method = 'PUT';
      requestBody = {
        content: base64Content,
        message: params.message,
        branch: params.branch,
        sha: file.sha
      };
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `token ${instance.token}`
      },
      body: JSON.stringify(requestBody)
    });

    if (response.ok) {
      result.succeeded++;
      result.details.operations.push({
        file: file.path,
        operation: file.operation,
        status: 'success'
      });
    } else {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText}`);
    }
  }

  private async executeDeleteOperation(
    instance: any,
    params: any,
    file: any,
    result: any
  ): Promise<void> {
    const requestBody = {
      message: params.message,
      branch: params.branch,
      sha: file.sha
    };

    const response = await fetch(`${instance.baseUrl}/api/v1/repos/${params.owner}/${params.repository}/contents/${file.path}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `token ${instance.token}`
      },
      body: JSON.stringify(requestBody)
    });

    if (response.ok) {
      result.succeeded++;
      result.details.operations.push({
        file: file.path,
        operation: file.operation,
        status: 'success'
      });
    } else {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Gitea MCP Server running on stdio');
  }
}

async function main() {
  try {
    // Validate configuration on startup
    const config = await validateConfig();
    
    // Set up global error handling
    setupErrorHandling();

    const server = new GiteaMcpServer();
    await server.run();

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
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

main().catch((error) => {
  logger.error("Unhandled error in main", { error });
  process.exit(1);
});
