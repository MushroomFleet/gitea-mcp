import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logging.js';
import { AppError, ErrorCode } from '../utils/error-handling.js';
import { loadConfig } from '../config/index.js';

export async function registerUploadFilesTool(server: McpServer) {
  server.tool(
    'upload_files',
    {
      description: 'Upload files and folders to Gitea repository while preserving directory structure',
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
                  description: 'File content (text or base64)'
                }
              },
              required: ['path', 'content']
            },
            minItems: 1,
            description: 'Array of files to upload'
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
          batchSize: {
            type: 'number',
            default: 10,
            description: 'Batch size for uploads'
          }
        },
        required: ['instanceId', 'owner', 'repository', 'files', 'message']
      }
    },
    async (args) => {
      try {
        logger.debug('Received arguments for upload_files', { args });
        
        // Manual parameter validation and defaults
        const params = {
          instanceId: args.instanceId,
          owner: args.owner,
          repository: args.repository,
          files: args.files || [],
          message: args.message,
          branch: args.branch || 'main',
          batchSize: args.batchSize || 10
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
        
        logger.info('Uploading files via MCP tool', {
          instanceId: params.instanceId,
          repository: `${params.owner}/${params.repository}`,
          fileCount: params.files.length
        });

        // Validate file paths and content
        const validatedFiles = params.files.map(file => {
          if (!file.path) {
            throw new Error('File path is required');
          }
          if (file.content === undefined || file.content === null) {
            throw new Error('File content is required');
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
            content: file.content
          };
        });

        // Get configuration and find the instance
        const config = loadConfig();
        const instance = config.gitea.instances.find(inst => inst.id === params.instanceId);
        
        if (!instance) {
          throw new Error(`Gitea instance '${params.instanceId}' not found`);
        }

        // Upload files one by one using direct API calls
        const results = [];
        
        for (const file of validatedFiles) {
          try {
            // Convert content to base64 if it's not already
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
              results.push({ status: 'fulfilled', file: file.path });
            } else {
              const errorText = await response.text();
              results.push({ 
                status: 'rejected', 
                file: file.path,
                reason: { message: `${response.status}: ${errorText}` }
              });
            }
          } catch (error) {
            results.push({ 
              status: 'rejected', 
              file: file.path,
              reason: { message: error instanceof Error ? error.message : 'Unknown error' }
            });
          }
        }

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
          `Failed to upload files: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }
  );
}
