import fetch from 'cross-fetch';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../utils/logging.js';
import { withRetry } from '../utils/retry.js';
import type { GiteaInstance } from '../config/index.js';

export class GiteaClient {
  private rateLimiter: RateLimiterMemory;
  private instance: GiteaInstance;

  constructor(instance: GiteaInstance) {
    this.instance = instance;

    // Set up rate limiting
    this.rateLimiter = new RateLimiterMemory({
      keyPrefix: `gitea_${instance.id}`,
      points: instance.rateLimit.requests,
      duration: instance.rateLimit.windowMs / 1000
    });
  }

  private async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
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
          'Authorization': `token ${this.instance.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Gitea-MCP-Server/1.0',
          ...options.headers
        }
      });

      if (response.status === 401) {
        throw new Error(`Authentication failed for ${this.instance.name}`);
      }

      if (response.status === 403) {
        throw new Error(`Insufficient permissions for ${this.instance.name}`);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
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

      const url = `${this.instance.baseUrl}/api/v1/user/repos`;
      const response = await this.makeRequest(url, {
        method: 'POST',
        body: JSON.stringify({
          name: params.name,
          description: params.description || '',
          private: params.private ?? true,
          auto_init: params.autoInit ?? true,
          default_branch: params.defaultBranch || 'main'
        })
      });

      const result = await response.json();

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
      
      const url = `${this.instance.baseUrl}/api/v1/repos/${params.owner}/${params.repo}/contents/${params.path}`;
      const response = await this.makeRequest(url, {
        method: 'POST',
        body: JSON.stringify({
          content: base64Content,
          message: params.message,
          branch: params.branch || 'main',
          author: {
            name: 'Gitea MCP Server',
            email: 'mcp@example.com'
          }
        })
      });

      return await response.json();
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
