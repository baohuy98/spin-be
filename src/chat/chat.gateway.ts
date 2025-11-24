import { Inject } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  STORAGE_SERVICE,
  type StorageService,
} from 'src/storage/interfaces/storage.interface';
import { SendMessageDto } from './dto/chat.dto';
import { Message } from './entities/message.entity';

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
  ) {}

  @SubscribeMessage('send-message')
  async handleSendMessage(@MessageBody() data: SendMessageDto) {
    const message = new Message({
      id: uuidv4(),
      userId: data.userId,
      userName: data.userName,
      message: data.message,
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
}
