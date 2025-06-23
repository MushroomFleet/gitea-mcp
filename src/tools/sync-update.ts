import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logging.js';
import { AppError, ErrorCode } from '../utils/error-handling.js';
import { loadConfig } from '../config/index.js';

interface FileOperation {
  path: string;
  content?: string;
  operation: 'add' | 'modify' | 'delete';
  sha?: string;
}

interface RemoteFileInfo {
  sha: string;
  content: string;
  path: string;
}

export async function registerSyncUpdateTool(server: McpServer) {
  server.tool(
    'sync_update',
    {
      description: 'Advanced tool for updating existing files in Gitea repository with conflict resolution',
      parameters: {
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
            default: 'main',
            description: 'Target branch'
          },
          strategy: {
            type: 'string',
            enum: ['auto', 'batch', 'individual'],
            default: 'auto',
            description: 'Update strategy: auto (choose best), batch (single commit), individual (separate commits)'
          },
          conflictResolution: {
            type: 'string',
            enum: ['fail', 'overwrite', 'skip'],
            default: 'fail',
            description: 'How to handle conflicts when remote files have changed'
          },
          detectChanges: {
            type: 'boolean',
            default: true,
            description: 'Compare with remote files to avoid unnecessary updates'
          },
          dryRun: {
            type: 'boolean',
            default: false,
            description: 'Preview operations without making changes'
          }
        },
        required: ['instanceId', 'owner', 'repository', 'files', 'message']
      }
    },
    async (args) => {
      try {
        logger.debug('Received arguments for sync_update', { args });
        
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
          throw new Error(`Gitea instance '${params.instanceId}' not found`);
        }

        logger.info('Starting sync_update operation', {
          instanceId: params.instanceId,
          repository: `${params.owner}/${params.repository}`,
          fileCount: params.files.length,
          strategy: params.strategy,
          dryRun: params.dryRun
        });

        // Validate and normalize file operations
        const normalizedFiles = await validateAndNormalizeFiles(params.files);

        // Detect what files need updating by comparing with remote
        const { needsUpdate, remoteFiles } = params.detectChanges 
          ? await detectChangesNeeded(instance, params, normalizedFiles)
          : { needsUpdate: normalizedFiles, remoteFiles: new Map() };

        // Determine strategy
        const strategy = determineStrategy(params.strategy, needsUpdate);

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
          await executeBatchUpdate(instance, params, needsUpdate, result);
        } else {
          await executeIndividualUpdates(instance, params, needsUpdate, result);
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
        
        if (error instanceof z.ZodError) {
          throw new AppError(
            ErrorCode.VALIDATION_ERROR,
            'Invalid parameters: ' + error.errors.map(e => e.message).join(', ')
          );
        }

        throw new AppError(
          ErrorCode.EXTERNAL_API_ERROR,
          `Failed to sync update files: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  );
}

async function validateAndNormalizeFiles(files: any[]): Promise<FileOperation[]> {
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
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid file path: ${file.path}`
      );
    }

    return {
      path: normalizedPath,
      content: file.content,
      operation: operation as 'add' | 'modify' | 'delete',
      sha: file.sha
    };
  });
}

async function detectChangesNeeded(
  instance: any, 
  params: any, 
  files: FileOperation[]
): Promise<{ needsUpdate: FileOperation[], remoteFiles: Map<string, RemoteFileInfo> }> {
  const remoteFiles = new Map<string, RemoteFileInfo>();
  const needsUpdate: FileOperation[] = [];

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

function determineStrategy(requestedStrategy: string, files: FileOperation[]): string {
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

async function executeBatchUpdate(
  instance: any,
  params: any,
  files: FileOperation[],
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

async function executeIndividualUpdates(
  instance: any,
  params: any,
  files: FileOperation[],
  result: any
): Promise<void> {
  for (const file of files) {
    result.processed++;
    
    try {
      if (file.operation === 'delete') {
        await executeDeleteOperation(instance, params, file, result);
      } else {
        await executeCreateOrUpdateOperation(instance, params, file, result);
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

async function executeCreateOrUpdateOperation(
  instance: any,
  params: any,
  file: FileOperation,
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

async function executeDeleteOperation(
  instance: any,
  params: any,
  file: FileOperation,
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
