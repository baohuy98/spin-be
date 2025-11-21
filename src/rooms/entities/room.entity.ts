export class Room {
  roomId: string;
  hostId: string;
  members: string[];
  createdAt: Date;

  constructor(partial: Partial<Room>) {
    Object.assign(this, partial);
  }
}
