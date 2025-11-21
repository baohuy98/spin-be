export class Message {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
  roomId: string;

  constructor(partial: Partial<Message>) {
    Object.assign(this, partial);
  }
}
