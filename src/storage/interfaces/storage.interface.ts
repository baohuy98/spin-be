import { Message } from '../../firebase/entities/message.entity';

export interface StorageService {
  saveMessage(message: Message): Promise<void>;
  getMessages(roomId: string, limit?: number): Promise<Message[]>;
  deleteRoomMessages(roomId: string): Promise<void>;
}

export const STORAGE_SERVICE = 'STORAGE_SERVICE';
