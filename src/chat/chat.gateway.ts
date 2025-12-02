import { Inject } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import {
  STORAGE_SERVICE,
  type StorageService,
} from 'src/storage/interfaces/storage.interface';
import { v4 as uuidv4 } from 'uuid';
import { ReactToMessageDto, SendMessageDto } from './dto/chat.dto';
import { Message } from './entities/message.entity';
import { MessageValidationService } from './services/message-validation.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
    private readonly messageValidationService: MessageValidationService,
  ) {}

  @SubscribeMessage('send-message')
  async handleSendMessage(@MessageBody() data: SendMessageDto) {
    const { containsProfanity, cleanedMessage } =
      this.messageValidationService.validateMessage(data.message);

    const message = new Message({
      id: uuidv4(),
      userId: data.userId,
      userName: data.userName,
      message: containsProfanity ? cleanedMessage : data.message,
      timestamp: Date.now(),
      roomId: data.roomId,
    });

    try {
      await this.storageService.saveMessage({ ...message });
    } catch (error) {
      console.error('Failed to save message:', error);
    }

    this.server.to(data.roomId).emit('chat-message', message);
  }

  @SubscribeMessage('react-to-message')
  async handleReactToMessage(@MessageBody() data: ReactToMessageDto) {
    try {
      const reactions = await this.storageService.addReaction(
        data.roomId,
        data.messageId,
        data.userId,
        data.emoji,
      );

      this.server.to(data.roomId).emit('message-reaction-updated', {
        messageId: data.messageId,
        reactions,
      });
    } catch (error) {
      console.error('Failed to add reaction:', error);
    }
  }
}
