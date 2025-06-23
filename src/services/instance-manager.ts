import { GiteaClient } from '../gitea/client.js';
import { loadConfig } from '../config/index.js';
import { AppError, ErrorCode } from '../utils/error-handling.js';
import { logger } from '../utils/logging.js';

class InstanceManager {
  private clients: Map<string, GiteaClient> = new Map();
  private initialized = false;

  async initialize() {
    if (this.initialized) {
      return;
    }

    const config = loadConfig();
    
    for (const instance of config.gitea.instances) {
      const client = new GiteaClient(instance);
      this.clients.set(instance.id, client);
      
      logger.info('Initialized Gitea client', {
        instanceId: instance.id,
        instanceName: instance.name,
        baseUrl: instance.baseUrl
      });
    }

    this.initialized = true;
    logger.info('Instance manager initialized', {
      instanceCount: this.clients.size
    });
  }

  getClient(instanceId: string): GiteaClient {
    if (!this.initialized) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        'Instance manager not initialized'
      );
    }

    const client = this.clients.get(instanceId);
    if (!client) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `Gitea instance '${instanceId}' not found`,
        404
      );
    }

    return client;
  }

  listInstances(): string[] {
    return Array.from(this.clients.keys());
  }
}

// Singleton instance
const instanceManager = new InstanceManager();

export async function getGiteaClient(instanceId: string): Promise<GiteaClient> {
  await instanceManager.initialize();
  return instanceManager.getClient(instanceId);
}

export async function listGiteaInstances(): Promise<string[]> {
  await instanceManager.initialize();
  return instanceManager.listInstances();
}
