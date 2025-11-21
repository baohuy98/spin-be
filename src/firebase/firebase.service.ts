import { Injectable, OnModuleInit } from '@nestjs/common';
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

  onModuleInit() {
    // Initialize Firebase Admin

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
