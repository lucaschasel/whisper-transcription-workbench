import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const configuredModel = () => path.resolve(process.env.WHISPER_MODEL || 'models/large-v3-turbo.pt');

export type WhisperModel = {
  id: string;
  name: string;
  size: number;
  isDefault: boolean;
};

export function listWhisperModels(): { models: WhisperModel[]; defaultModel: string } {
  const configured = configuredModel();
  const directory = path.dirname(configured);
  const configuredId = path.basename(configured);
  const models = existsSync(directory)
    ? readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.pt')
        .map((entry) => ({
          id: entry.name,
          name: path.basename(entry.name, path.extname(entry.name)),
          size: statSync(path.join(directory, entry.name)).size,
          isDefault: entry.name === configuredId,
        }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    : [];
  const defaultModel = models.find((model) => model.isDefault)?.id || models[0]?.id || configuredId;
  return { models, defaultModel };
}

export function resolveWhisperModel(modelId: string): string | null {
  const configured = configuredModel();
  const { models } = listWhisperModels();
  return models.some((model) => model.id === modelId)
    ? path.join(path.dirname(configured), modelId)
    : null;
}
