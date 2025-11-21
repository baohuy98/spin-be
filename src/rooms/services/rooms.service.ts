import { Injectable } from '@nestjs/common';
import { RoomsRepository } from '../repositories/rooms.repository';
import { Room } from '../entities/room.entity';

export interface MemberLeftResult {
  memberId: string;
  members: string[];
  roomDeleted: boolean;
}

@Injectable()
export class RoomsService {
  constructor(private readonly roomsRepository: RoomsRepository) {}

  createRoom(hostId: string): Room {
    const roomId = `room-${Date.now()}`;
    const room = new Room({
      roomId,
      hostId,
      members: [hostId],
      createdAt: new Date(),
    });

    return this.roomsRepository.createRoom(room);
  }

  findRoomById(roomId: string): Room | undefined {
    return this.roomsRepository.findRoomById(roomId);
  }

  validateRoom(roomId: string): { exists: boolean; roomId: string; memberCount?: number } {
    const room = this.roomsRepository.findRoomById(roomId);

    if (room) {
      return {
        exists: true,
        roomId: room.roomId,
        memberCount: room.members.length,
      };
    }

    return {
      exists: false,
      roomId,
    };
  }

  joinRoom(roomId: string, memberId: string): Room | null {
    const room = this.roomsRepository.findRoomById(roomId);
    if (!room) {
      return null;
    }

    this.roomsRepository.addMemberToRoom(roomId, memberId);
    return room;
  }

  leaveRoom(roomId: string, memberId: string): MemberLeftResult | null {
    const room = this.roomsRepository.findRoomById(roomId);
    if (!room) {
      return null;
    }

    const removed = this.roomsRepository.removeMemberFromRoom(roomId, memberId);
    if (!removed) {
      return null;
    }

    let roomDeleted = false;
    if (room.members.length === 0) {
      this.roomsRepository.deleteRoom(roomId);
      roomDeleted = true;
    }

    return {
      memberId,
      members: room.members,
      roomDeleted,
    };
  }

  // User-Socket mapping methods
  setUserSocket(userId: string, socketId: string): void {
    this.roomsRepository.setUserSocket(userId, socketId);
  }

  getUserSocket(userId: string): string | undefined {
    return this.roomsRepository.getUserSocket(userId);
  }

  deleteUserSocket(userId: string): void {
    this.roomsRepository.deleteUserSocket(userId);
  }

  findUserIdBySocketId(socketId: string): string | null {
    return this.roomsRepository.findUserIdBySocketId(socketId);
  }

  // User-Room mapping methods
  setUserRoom(userId: string, roomId: string): void {
    this.roomsRepository.setUserRoom(userId, roomId);
  }

  getUserRoom(userId: string): string | undefined {
    return this.roomsRepository.getUserRoom(userId);
  }

  deleteUserRoom(userId: string): void {
    this.roomsRepository.deleteUserRoom(userId);
  }

  // Helper method to handle user leaving (for disconnect scenarios)
  handleUserDisconnect(userId: string): MemberLeftResult | null {
    const roomId = this.getUserRoom(userId);
    if (!roomId) {
      return null;
    }

    const result = this.leaveRoom(roomId, userId);
    this.deleteUserSocket(userId);
    this.deleteUserRoom(userId);

    return result;
  }
}
