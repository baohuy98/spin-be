import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // 'firebase' | 'json'
  type: process.env.STORAGE_TYPE || 'firebase',
  jsonFilePath: process.env.JSON_STORAGE_PATH || './data',
}));
