import { Message, MessageReaction } from '../../chat/entities/message.entity';

export interface StorageService {
  saveMessage(message: Message): Promise<void>;
  getMessages(roomId: string, limit?: number): Promise<Message[]>;
  deleteRoomMessages(roomId: string): Promise<void>;
  addReaction(
    roomId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction[]>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
