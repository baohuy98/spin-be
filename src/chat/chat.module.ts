import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [ChatGateway],
})
export class ChatModule {}
