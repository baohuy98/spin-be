export class Room {
  roomId: string;
  hostId: string;
  members: string[];
  createdAt: Date;
  theme?: string; // Festive theme: 'none', 'christmas', 'lunar-new-year'

  constructor(partial: Partial<Room>) {
    Object.assign(this, partial);
  }
}
