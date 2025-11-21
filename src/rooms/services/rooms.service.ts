import { Injectable } from '@nestjs/common';
import {
  RoomsRepository,
  LoggedInUser,
} from '../repositories/rooms.repository';
import { Room } from '../entities/room.entity';
import * as crypto from 'crypto';

export interface MemberLeftResult {
  memberId: string;
  members: string[];
  roomDeleted: boolean;
}

export type { LoggedInUser };

@Injectable()
export class RoomsService {
  constructor(private readonly roomsRepository: RoomsRepository) {}


  /**
   * Generate a deterministic room ID based on host ID
   * Uses SHA256 hash to create a unique and stable room ID per host
   * Same host always gets the same room ID for stable chat logs
   */
  private generateRoomId(hostId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`room-${hostId}`)
      .digest('hex')
      .substring(0, 12); // Take first 12 characters
    return `room-${hash}`;
  }

  /**
   * Generate a hashed viewer ID for privacy/security
   * This creates a consistent hash of the viewer ID
   */
  generateHashedViewerId(viewerId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(viewerId)
      .digest('hex')
      .substring(0, 16); // Take first 16 characters
    return `vie      wer-${hash}`;
  }

  createRoom(hostId: string): Room {
    const roomId = this.generateRoomId(hostId);

    // Check if room already exists for this host (stable room ID)
    const existingRoom = this.roomsRepository.findRoomById(roomId);
    if (existingRoom) {
      console.log(`[RoomsService] Reusing existing room ${roomId} for host ${hostId}`);
      // Ensure host is in members list
      if (!existingRoom.members.includes(hostId)) {
        existingRoom.members.push(hostId);
      }
      return existingRoom;
    }

    // Create new room if doesn't exist
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

    // Delete room if HOST leaves (not just any member)
    // For viewers leaving: room persists
    // For host leaving: room is deleted
    let roomDeleted = false;
    if (memberId === room.hostId) {
      this.roomsRepository.deleteRoom(roomId);
      roomDeleted = true;
      console.log(`Room ${roomId} deleted because host ${memberId} left`);
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

  // Logged-in users management
  addLoggedInUser(genID: string, name: string, roomId: string | null, socketId: string): void {
    this.roomsRepository.addLoggedInUser(genID, name, roomId, socketId);
  }

  getLoggedInUser(genID: string): LoggedInUser | undefined {
    return this.roomsRepository.getLoggedInUser(genID);
  }

  isUserLoggedInToRoom(genID: string, roomId: string): boolean {
    return this.roomsRepository.isUserLoggedInToRoom(genID, roomId);
  }

  updateLoggedInUserRoom(genID: string, roomId: string | null): boolean {
    return this.roomsRepository.updateLoggedInUserRoom(genID, roomId);
  }

  updateLoggedInUserSocket(genID: string, socketId: string): boolean {
    return this.roomsRepository.updateLoggedInUserSocket(genID, socketId);
  }

  removeLoggedInUser(genID: string): boolean {
    return this.roomsRepository.removeLoggedInUser(genID);
  }

  getAllLoggedInUsers(): LoggedInUser[] {
    return this.roomsRepository.getAllLoggedInUsers();
  }

  getLoggedInUsersByRoom(roomId: string): LoggedInUser[] {
    return this.roomsRepository.getLoggedInUsersByRoom(roomId);
  }

  // Get room members with full details (name + genID)
  getRoomMembersWithDetails(roomId: string): Array<{ genID: string; name: string; isHost: boolean }> {
    const room = this.roomsRepository.findRoomById(roomId);
    if (!room) {
      return [];
    }

    return room.members.map(memberId => {
      const loggedInUser = this.roomsRepository.getLoggedInUser(memberId);
      return {
        genID: memberId,
        name: loggedInUser?.name || `User ${memberId}`,
        isHost: memberId === room.hostId
      };
    });
  }
}
