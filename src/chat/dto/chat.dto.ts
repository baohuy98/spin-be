export class SendMessageDto {
  userId: string;
  userName: string;
  message: string;
  roomId: string;
}

export class ReactToMessageDto {
  roomId: string;
  messageId: string;
  userId: string;
  emoji: string;
}
