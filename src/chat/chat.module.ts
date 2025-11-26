import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { StorageModule } from '../storage/storage.module';
import { MessageValidationService } from './services/message-validation.service';

@Module({
  imports: [StorageModule],
  providers: [ChatGateway, MessageValidationService],
})
export class ChatModule {}
