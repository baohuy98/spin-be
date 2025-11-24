export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export class Message {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  roomId: string;
  reactions?: MessageReaction[];

  constructor(partial: Partial<Message>) {
    Object.assign(this, partial);
  }
}
