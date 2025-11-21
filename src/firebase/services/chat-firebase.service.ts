import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { Message } from '../entities/message.entity';

@Injectable()
export class FirebaseService implements OnModuleInit {
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
      console.log('Message saved to Firebase:', message.id);
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
      console.log(`Deleted all messages for room: ${roomId}`);
    } catch (error) {
      console.error('Error deleting room messages:', error);
    }
  }
}
