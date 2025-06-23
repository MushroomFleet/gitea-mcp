import { z } from 'zod';

export const GiteaInstanceSchema = z.object({
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

export const ConfigSchema = z.object({
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
