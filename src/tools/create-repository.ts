import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logging.js';
import { loadConfig } from '../config/index.js';

export function registerCreateRepositoryTool(server: Server) {
  // Register the tool in the list of available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
              default: true,
              description: 'Make repository private'
            },
            autoInit: {
              type: 'boolean',
              default: true,
              description: 'Initialize with README'
            },
            defaultBranch: {
              type: 'string',
              default: 'main',
              description: 'Default branch name'
            }
          },
          required: ['instanceId', 'name']
        }
      }
    ]
  }));

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'create_repository') {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }

    try {
      logger.debug('Received arguments for create_repository', { args: request.params.arguments });
      
      const args = request.params.arguments as any;
      
      // Manual parameter validation and defaults
      const params = {
        instanceId: args.instanceId,
        name: args.name,
        description: args.description || '',
        private: args.private !== undefined ? args.private : true,
        autoInit: args.autoInit !== undefined ? args.autoInit : true,
        defaultBranch: args.defaultBranch || 'main'
      };
      
      // Basic validation
      if (!params.instanceId) {
        throw new McpError(ErrorCode.InvalidParams, 'instanceId is required');
      }
      if (!params.name || params.name.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidParams, 'name is required and cannot be empty');
      }
      
      logger.info('Creating repository via MCP tool', {
        instanceId: params.instanceId,
        repository: params.name
      });

      // Get configuration and find the instance
      const config = loadConfig();
      const instance = config.gitea.instances.find(inst => inst.id === params.instanceId);
      
      if (!instance) {
        throw new McpError(ErrorCode.InvalidParams, `Gitea instance '${params.instanceId}' not found`);
      }

      // Make direct API call to create repository
      const requestBody = {
        name: params.name,
        description: params.description,
        private: params.private,
        auto_init: params.autoInit,
        default_branch: params.defaultBranch
      };

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
        throw new McpError(
          ErrorCode.InternalError,
          `API request failed: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const repository = await response.json();

      logger.info('Repository created successfully', {
        instanceId: params.instanceId,
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
              sshUrl: repository.ssh_url,
              private: repository.private,
              createdAt: repository.created_at
            }
          }, null, 2)
        }]
      };

    } catch (error) {
      logger.error('Failed to create repository', { error, args: request.params.arguments });
      
      if (error instanceof McpError) {
        throw error;
      }

      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create repository: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
}
