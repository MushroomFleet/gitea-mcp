import { loadConfig } from './index.js';
import { logger } from '../utils/logging.js';

export async function validateConfig() {
  try {
    const config = loadConfig();
    
    // Validate Gitea instances configuration
    if (config.gitea.instances.length === 0) {
      throw new Error('At least one Gitea instance must be configured');
    }

    // Validate each instance has required fields
    for (const instance of config.gitea.instances) {
      if (!instance.token) {
        throw new Error(`Gitea instance '${instance.id}' is missing required token`);
      }
      
      if (!instance.baseUrl) {
        throw new Error(`Gitea instance '${instance.id}' is missing required baseUrl`);
      }
    }

    logger.info('Configuration validation passed', {
      instanceCount: config.gitea.instances.length,
      environment: config.server.environment
    });

    return config;
  } catch (error) {
    logger.error('Configuration validation failed', { 
      error, 
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
