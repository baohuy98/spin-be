/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Message, MessageReaction } from '../../chat/entities/message.entity';
import { StorageService } from '../interfaces/storage.interface';

interface StorageData {
  messages: Message[];
}

@Injectable()
export class JsonStorageService implements StorageService, OnModuleInit {
  private dataFilePath: string;
  private data: StorageData = { messages: [] };

  constructor(private configService: ConfigService) {
    const storagePath =
      this.configService.get<string>('storage.jsonFilePath') || './data';
    this.dataFilePath = path.resolve(storagePath, 'messages.json');
  }

  async onModuleInit() {
    await this.ensureDataDirectory();
    await this.loadData();
  }

  private async ensureDataDirectory(): Promise<void> {
    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async loadData(): Promise<void> {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const fileContent = fs.readFileSync(this.dataFilePath, 'utf-8');
        this.data = JSON.parse(fileContent) as StorageData;
      } else {
        this.data = { messages: [] };
        await this.saveData();
      }
    } catch (error) {
      console.error('Error loading JSON data:', error);
      this.data = { messages: [] };
    }
  }

  private async saveData(): Promise<void> {
    try {
      fs.writeFileSync(
        this.dataFilePath,
        JSON.stringify(this.data, null, 2),
        'utf-8',
      );
    } catch (error) {
      console.error('Error saving JSON data:', error);
      throw error;
    }
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      this.data.messages.push(message);
      await this.saveData();
    } catch (error) {
      console.error('Error saving message to JSON:', error);
      throw error;
    }
  }

  async getMessages(roomId: string, limit = 50): Promise<Message[]> {
    try {
      const roomMessages = this.data.messages
        .filter((msg) => msg.roomId === roomId)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, limit);

      return roomMessages;
    } catch (error) {
      console.error('Error fetching messages from JSON:', error);
      return [];
    }
  }

  async deleteRoomMessages(roomId: string): Promise<void> {
    try {
      this.data.messages = this.data.messages.filter(
        (msg) => msg.roomId !== roomId,
      );
      await this.saveData();
    } catch (error) {
      console.error('Error deleting room messages from JSON:', error);
    }
  }

  async addReaction(
    roomId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction[]> {
    try {
      const message = this.data.messages.find(
        (msg) => msg.id === messageId && msg.roomId === roomId,
      );

      if (!message) {
        throw new Error('Message not found');
      }

      if (!message.reactions) {
        message.reactions = [];
      }

      const existingReaction = message.reactions.find((r) => r.emoji === emoji);

      if (existingReaction) {
        if (existingReaction.userIds.includes(userId)) {
          // Remove user from reaction (toggle off)
          existingReaction.userIds = existingReaction.userIds.filter(
            (id) => id !== userId,
          );
          // Remove reaction if no users left
          if (existingReaction.userIds.length === 0) {
            message.reactions = message.reactions.filter(
              (r) => r.emoji !== emoji,
            );
          }
        } else {
          // Add user to existing reaction
          existingReaction.userIds.push(userId);
        }
      } else {
        // Create new reaction
        message.reactions.push({ emoji, userIds: [userId] });
      }

      await this.saveData();
      return message.reactions;
    } catch (error) {
      console.error('Error adding reaction to JSON:', error);
      throw error;
    }
  }
}
