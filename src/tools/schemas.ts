import { z } from 'zod';

export const CreateRepositorySchema = z.object({
  instanceId: z.string().describe('Gitea instance identifier'),
  name: z.string().min(1).describe('Repository name'),
  description: z.string().optional().describe('Repository description'),
  private: z.boolean().default(true).describe('Make repository private'),
  autoInit: z.boolean().default(true).describe('Initialize with README'),
  defaultBranch: z.string().default('main').describe('Default branch name')
});

export const FileSchema = z.object({
  path: z.string().describe('File path in repository'),
  content: z.string().describe('File content (text or base64)')
});

export const UploadFilesSchema = z.object({
  instanceId: z.string().describe('Gitea instance identifier'),
  owner: z.string().describe('Repository owner'),
  repository: z.string().describe('Repository name'),
  files: z.array(FileSchema).min(1).describe('Array of files to upload'),
  message: z.string().describe('Commit message'),
  branch: z.string().default('main').describe('Target branch'),
  batchSize: z.number().default(10).describe('Batch size for uploads')
});

export type CreateRepositoryParams = z.infer<typeof CreateRepositorySchema>;
export type UploadFilesParams = z.infer<typeof UploadFilesSchema>;
export type FileParams = z.infer<typeof FileSchema>;
