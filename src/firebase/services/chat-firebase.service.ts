import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  roomId: string;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private db: admin.firestore.Firestore;

  constructor(private configService: ConfigService) { }

  onModuleInit() {
    // Initialize Firebase Admin
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

  async saveMessage(message: ChatMessage): Promise<void> {
    try {
      await this.db
        .collection('rooms')
        .doc(message.roomId)
        .collection('messages')
        .doc(message.id)
        .set(message);
      console.log('Message saved to Firebase:', message.id);
    } catch (error) {
      console.error('Error saving message to Firebase:', error);
      throw error;
    }
  }

  async getMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
    try {
      const snapshot = await this.db
        .collection('rooms')
        .doc(roomId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const messages: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        messages.push(doc.data() as ChatMessage);
      });

      // Return in ascending order (oldest first)
      return messages.reverse();
    } catch (error) {
      console.error('Error fetching messages from Firebase:', error);
      return [];
    }
  }

  async deleteRoomMessages(roomId: string): Promise<void> {
    try {
      const snapshot = await this.db
        .collection('rooms')
        .doc(roomId)
        .collection('messages')
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
