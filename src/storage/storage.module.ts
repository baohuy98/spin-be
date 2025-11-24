import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../firebase/services/chat-firebase.service';
import { JsonStorageService } from './services/json-storage.service';
import { STORAGE_SERVICE } from './interfaces/storage.interface';

@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (configService: ConfigService) => {
        const storageType = configService.get<string>('storage.type');
        if (storageType === 'json') {
          return new JsonStorageService(configService);
        }
        return new FirebaseService(configService);
      },
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
