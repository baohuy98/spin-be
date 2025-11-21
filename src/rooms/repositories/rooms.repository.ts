import { Injectable } from '@nestjs/common';
import { Room } from '../entities/room.entity';

export interface LoggedInUser {
  genID: string;
  name: string;
  roomId: string | null;
  socketId: string;
}

@Injectable()
export class RoomsRepository {
  private rooms: Map<string, Room> = new Map();
  private userSocketMap: Map<string, string> = new Map();
  private userRoomMap: Map<string, string> = new Map();
  private loggedInUsers: Map<string, LoggedInUser> = new Map();

  // Room operations
  createRoom(room: Room): Room {
    this.rooms.set(room.roomId, room);
    return room;
  }

  findRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  // User-Socket mapping operations
  setUserSocket(userId: string, socketId: string): void {
    this.userSocketMap.set(userId, socketId);
  }

  getUserSocket(userId: string): string | undefined {
    return this.userSocketMap.get(userId);
  }

  deleteUserSocket(userId: string): boolean {
    return this.userSocketMap.delete(userId);
  }

  findUserIdBySocketId(socketId: string): string | null {
    for (const [userId, userSocketId] of this.userSocketMap.entries()) {
      if (userSocketId === socketId) {
        return userId;
      }
    }
    return null;
  }

  // User-Room mapping operations
  setUserRoom(userId: string, roomId: string): void {
    this.userRoomMap.set(userId, roomId);
  }

  getUserRoom(userId: string): string | undefined {
    return this.userRoomMap.get(userId);
  }

  deleteUserRoom(userId: string): boolean {
    return this.userRoomMap.delete(userId);
  }

  // Room member operations
  addMemberToRoom(roomId: string, memberId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    if (!room.members.includes(memberId)) {
      room.members.push(memberId);
    }
    return true;
  }

  removeMemberFromRoom(roomId: string, memberId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) {
      return false;
    }

    const index = room.members.indexOf(memberId);
    if (index > -1) {
      room.members.splice(index, 1);
      return true;
    }
    return false;
  }

  // Logged-in users operations
  addLoggedInUser(genID: string, name: string, roomId: string | null, socketId: string): void {
    this.loggedInUsers.set(genID, { genID, name, roomId, socketId });
  }

  getLoggedInUser(genID: string): LoggedInUser | undefined {
    return this.loggedInUsers.get(genID);
  }

  isUserLoggedInToRoom(genID: string, roomId: string): boolean {
    const user = this.loggedInUsers.get(genID);
    return user !== undefined && user.roomId === roomId;
  }

  updateLoggedInUserRoom(genID: string, roomId: string | null): boolean {
    const user = this.loggedInUsers.get(genID);
    if (!user) {
      return false;
    }
    user.roomId = roomId;
    return true;
  }

  updateLoggedInUserSocket(genID: string, socketId: string): boolean {
    const user = this.loggedInUsers.get(genID);
    if (!user) {
      return false;
    }
    user.socketId = socketId;
    return true;
  }

  removeLoggedInUser(genID: string): boolean {
    return this.loggedInUsers.delete(genID);
  }

  getAllLoggedInUsers(): LoggedInUser[] {
    return Array.from(this.loggedInUsers.values());
  }

  getLoggedInUsersByRoom(roomId: string): LoggedInUser[] {
    return Array.from(this.loggedInUsers.values()).filter(
      user => user.roomId === roomId
    );
  }
}
