import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Message, MessageReaction } from '../../chat/entities/message.entity';
import { StorageService } from '../interfaces/storage.interface';

@Injectable()
export class FirebaseService implements StorageService, OnModuleInit {
  private db: admin.firestore.Firestore;

  constructor(private configService: ConfigService) { }

  onModuleInit() {
    if (!admin.apps.length) {
      const projectId = this.configService.get<string>('firebase.projectId');
      const clientEmail = this.configService.get<string>(
        'firebase.clientEmail',
      );
      const privateKey = this.configService.get<string>('firebase.privateKey');

      if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
          'Firebase configuration is missing. Please check your .env file.',
        );
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }

    this.db = admin.firestore();
  }

  async saveMessage(message: Message): Promise<void> {
    try {
      await this.db.collection('messages').doc(message.id).set(message);
    } catch (error) {
      console.error('Error saving message to Firebase:', error);
      throw error;
    }
  }

  async getMessages(roomId: string, limit = 50): Promise<Message[]> {
    try {
      const snapshot = await this.db
        .collection('messages')
        .where('roomId', '==', roomId)
        .orderBy('timestamp', 'asc')
        .limit(limit)
        .get();

      const messages: Message[] = [];
      snapshot.forEach((doc) => {
        messages.push(doc.data() as Message);
      });

      return messages;
    } catch (error) {
      console.error('Error fetching messages from Firebase:', error);
      return [];
    }
  }

  async deleteRoomMessages(roomId: string): Promise<void> {
    try {
      const snapshot = await this.db
        .collection('messages')
        .where('roomId', '==', roomId)
        .get();

      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
    } catch (error) {
      console.error('Error deleting room messages:', error);
    }
  }

  async addReaction(
    roomId: string,
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction[]> {
    try {
      const docRef = this.db.collection('messages').doc(messageId);
      const doc = await docRef.get();

      if (!doc.exists) {
        throw new Error('Message not found');
      }

      const message = doc.data() as Message;

      if (message.roomId !== roomId) {
        throw new Error('Message not found in this room');
      }

      const reactions: MessageReaction[] = message.reactions || [];
      const existingReaction = reactions.find((r) => r.emoji === emoji);

      if (existingReaction) {
        if (existingReaction.userIds.includes(userId)) {
          // Remove user from reaction (toggle off)
          existingReaction.userIds = existingReaction.userIds.filter(
            (id) => id !== userId,
          );
          // Remove reaction if no users left
          if (existingReaction.userIds.length === 0) {
            const index = reactions.indexOf(existingReaction);
            reactions.splice(index, 1);
          }
        } else {
          // Add user to existing reaction
          existingReaction.userIds.push(userId);
        }
      } else {
        // Create new reaction
        reactions.push({ emoji, userIds: [userId] });
      }

      await docRef.update({ reactions });
      return reactions;
    } catch (error) {
      console.error('Error adding reaction to Firebase:', error);
      throw error;
    }
  }
}
