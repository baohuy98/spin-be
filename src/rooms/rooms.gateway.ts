import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  STORAGE_SERVICE,
  type StorageService,
} from 'src/storage/interfaces/storage.interface';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { LeaveRoomDto } from './dto/leave-room.dto';
import { SpinResultDto } from './dto/spin-result.dto';
import { ValidateRoomDto } from './dto/validate-room.dto';
import {
  AnswerDto,
  HostReadyDto,
  IceCandidateDto,
  OfferDto,
  StopSharingDto,
} from './dto/webrtc.dto';
import { RoomsService } from './services/rooms.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Track pending disconnects with grace period for reconnection
  private pendingDisconnects: Map<string, NodeJS.Timeout> = new Map();
  private readonly DISCONNECT_GRACE_PERIOD = 10000; // 10 seconds for page reload

  constructor(
    private readonly roomsService: RoomsService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) { }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    const userId = this.roomsService.findUserIdBySocketId(client.id);
    if (!userId) {
      return;
    }

    const roomId = this.roomsService.getUserRoom(userId);
    const room = roomId ? this.roomsService.findRoomById(roomId) : null;
    const isHost = room && userId === room.hostId;

    // Use grace period for both host and viewers to handle page reloads
    console.log(`${isHost ? 'Host' : 'Viewer'} ${userId} disconnected, starting ${this.DISCONNECT_GRACE_PERIOD}ms grace period`);

    // Clear any existing pending disconnect for this user
    const existingTimeout = this.pendingDisconnects.get(userId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set new pending disconnect with grace period
    const timeout = setTimeout(() => {
      console.log(`Grace period expired for ${userId}, processing disconnect`);
      this.pendingDisconnects.delete(userId);
      this.processUserDisconnect(userId, roomId);
    }, this.DISCONNECT_GRACE_PERIOD);

    this.pendingDisconnects.set(userId, timeout);
  }

  // Cancel pending disconnect when user reconnects
  cancelPendingDisconnect(userId: string): boolean {
    const timeout = this.pendingDisconnects.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingDisconnects.delete(userId);
      console.log(`Cancelled pending disconnect for ${userId} (reconnected)`);
      return true;
    }
    return false;
  }

  // Actually process the disconnect (remove from room, clean up)
  private processUserDisconnect(userId: string, roomId: string | undefined) {
    // Safety check: if user already reconnected with a new socket, don't process disconnect
    const currentSocketId = this.roomsService.getUserSocket(userId);
    if (currentSocketId) {
      const socket = this.server.sockets.sockets.get(currentSocketId);
      if (socket && socket.connected) {
        console.log(`[SKIP] User ${userId} already reconnected with socket ${currentSocketId}, skipping disconnect`);
        return;
      }
    }

    const result = this.roomsService.handleUserDisconnect(userId);
    if (result && roomId) {
      // Get updated members with details (if room still exists)
      const membersWithDetails = result.roomDeleted
        ? []
        : this.roomsService.getRoomMembersWithDetails(roomId);

      this.server.to(roomId).emit('member-left', {
        memberId: result.memberId,
        members: result.members,
        membersWithDetails,
      });
      console.log(`${userId} left room: ${roomId}`);

      if (result.roomDeleted) {
        console.log(`Room deleted: ${roomId}`);
      }
    }

    // Remove from logged-in users
    this.roomsService.removeLoggedInUser(userId);
  }

  async handleGetChatHistory(client: Socket, roomId: string) {
    // Send messages history when user joined room/host created room
    const messages = await this.storageService.getMessages(roomId);
    client.emit('chat-history', { messages });
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(
    @MessageBody() data: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    // Cancel any pending disconnect for this host (they're reconnecting)
    this.cancelPendingDisconnect(data.hostId);

    // Check if host already has an existing room (for rejoin scenario)
    const existingRoomId = this.roomsService.getUserRoom(data.hostId);
    const existingRoom = existingRoomId ? this.roomsService.findRoomById(existingRoomId) : null;
    const hasExistingViewers = existingRoom && existingRoom.members.length > 1;

    if (existingRoomId) {
      // Check if this is a different socket (host reconnecting/reloading)
      const existingSocketId = this.roomsService.getUserSocket(data.hostId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(`Disconnecting old socket ${existingSocketId} for host ${data.hostId}`);
        // Disconnect the old socket without triggering full cleanup
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
          oldSocket.disconnect(true);
        }
      }

      // If there are existing viewers, DON'T delete the room - host is just rejoining
      if (!hasExistingViewers) {
        // No viewers, safe to clean up and recreate
        const result = this.roomsService.leaveRoom(existingRoomId, data.hostId);
        if (result) {
          void client.leave(existingRoomId);
          console.log(`${data.hostId} left empty room ${existingRoomId}`);
        }
      }
    }

    // Get or create the room
    const room = this.roomsService.createRoom(data.hostId);
    const isRejoining = room.members.length > 1; // More than just host means existing viewers

    // Update host's socket mapping
    this.roomsService.setUserSocket(data.hostId, client.id);
    this.roomsService.setUserRoom(data.hostId, room.roomId);

    // Add/update host in logged-in users array
    this.roomsService.addLoggedInUser(data.hostId, data.name, room.roomId, client.id);

    void client.join(room.roomId);

    console.log(`Room created/rejoined: ${room.roomId} by ${data.hostId} (${data.name}), viewers: ${room.members.length - 1}`);

    const membersWithDetails = this.roomsService.getRoomMembersWithDetails(room.roomId);

    client.emit('room-created', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
      membersWithDetails,
    });

    // If host is rejoining with existing viewers, notify them to reset WebRTC
    if (isRejoining) {
      console.log(`Host rejoined room ${room.roomId} with ${room.members.length - 1} existing viewers, notifying them`);
      client.to(room.roomId).emit('host-reconnected', {
        hostId: data.hostId,
        hostSocketId: client.id,
      });
    }

    void this.handleGetChatHistory(client, room.roomId);
  }

  @SubscribeMessage('validate-room')
  handleValidateRoom(
    @MessageBody() data: ValidateRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    const validation = this.roomsService.validateRoom(data.roomId);
    client.emit('room-validated', validation);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.roomsService.findRoomById(data.roomId);

    if (!room) {
      console.log(`Room not found: ${data.roomId}`);
      client.emit('error', { message: 'Room not found' });
      return;
    }

    // Cancel any pending disconnect for this user (they're reconnecting)
    const wasReconnecting = this.cancelPendingDisconnect(data.memberId);

    // Check if user is already in room.members (they're rejoining/reconnecting)
    const isAlreadyInRoom = room.members.includes(data.memberId);

    // Check if user is logged in to this specific room
    const isLoggedInToRoom = this.roomsService.isUserLoggedInToRoom(data.memberId, data.roomId);

    // Handle reconnection: user is in room.members OR was in grace period OR is logged in
    if (isAlreadyInRoom || wasReconnecting || isLoggedInToRoom) {
      console.log(`${data.memberId} (${data.name}) reconnecting to room ${data.roomId} [inRoom=${isAlreadyInRoom}, wasReconnecting=${wasReconnecting}, loggedIn=${isLoggedInToRoom}]`);

      // Handle old socket if exists
      const existingSocketId = this.roomsService.getUserSocket(data.memberId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(`Updating socket for ${data.memberId}: ${existingSocketId} -> ${client.id}`);
        // Disconnect the old socket if still connected
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket && oldSocket.connected) {
          oldSocket.disconnect(true);
        }
      }

      // Update all mappings with new socket
      this.roomsService.setUserSocket(data.memberId, client.id);
      this.roomsService.setUserRoom(data.memberId, data.roomId);
      this.roomsService.addLoggedInUser(data.memberId, data.name, data.roomId, client.id);

      // Make sure user is in room.members (might have been removed during grace period)
      if (!isAlreadyInRoom) {
        this.roomsService.joinRoom(data.roomId, data.memberId);
      }

      // Join the socket.io room
      void client.join(data.roomId);

      const membersWithDetails = this.roomsService.getRoomMembersWithDetails(room.roomId);

      client.emit('room-joined', {
        roomId: room.roomId,
        hostId: room.hostId,
        members: room.members,
        membersWithDetails,
      });

      // Notify host that viewer reconnected (for WebRTC setup)
      if (data.memberId !== room.hostId) {
        const hostSocketId = this.roomsService.getUserSocket(room.hostId);
        if (hostSocketId) {
          this.server.to(hostSocketId).emit('viewer-joined', {
            viewerId: client.id,
          });
        }
      }

      void this.handleGetChatHistory(client, data.roomId);
      return;
    }

    // Check if user is already in a different room
    const existingRoomId = this.roomsService.getUserRoom(data.memberId);
    if (existingRoomId && existingRoomId !== data.roomId) {
      // Leave the existing room first
      const result = this.roomsService.leaveRoom(existingRoomId, data.memberId);
      if (result) {
        void client.leave(existingRoomId);
        this.server.to(existingRoomId).emit('member-left', {
          memberId: result.memberId,
          members: result.members,
        });
        console.log(
          `${data.memberId} left previous room ${existingRoomId} to join ${data.roomId}`,
        );
      }
    }

    // Add member to room
    const updatedRoom = this.roomsService.joinRoom(data.roomId, data.memberId);
    if (!updatedRoom) {
      client.emit('error', { message: 'Failed to join room' });
      return;
    }

    this.roomsService.setUserSocket(data.memberId, client.id);
    this.roomsService.setUserRoom(data.memberId, data.roomId);

    // Add user to logged-in users array
    this.roomsService.addLoggedInUser(data.memberId, data.name, data.roomId, client.id);

    void client.join(data.roomId);

    console.log(`${data.memberId} (${data.name}) joined room: ${data.roomId}`);

    const membersWithDetails = this.roomsService.getRoomMembersWithDetails(data.roomId);

    client.emit('room-joined', {
      roomId: updatedRoom.roomId,
      hostId: updatedRoom.hostId,
      members: updatedRoom.members,
      membersWithDetails,
    });

    client.to(data.roomId).emit('member-joined', {
      memberId: data.memberId,
      memberName: data.name,
      members: updatedRoom.members,
      membersWithDetails,
    });

    // Notify host that a new viewer joined (for WebRTC setup)
    if (data.memberId !== updatedRoom.hostId) {
      const hostSocketId = this.roomsService.getUserSocket(updatedRoom.hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('viewer-joined', {
          viewerId: client.id,
        });
      }
    }

    void this.handleGetChatHistory(client, data.roomId);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() data: LeaveRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    const result = this.roomsService.leaveRoom(data.roomId, data.memberId);
    if (result) {
      this.server.to(data.roomId).emit('member-left', {
        memberId: result.memberId,
        members: result.members,
      });

      if (result.roomDeleted) {
        console.log(`Room deleted: ${data.roomId}`);
      }
    }

    this.roomsService.deleteUserSocket(data.memberId);
    this.roomsService.deleteUserRoom(data.memberId);
    this.roomsService.removeLoggedInUser(data.memberId);
    void client.leave(data.roomId);
  }

  @SubscribeMessage('spin-result')
  handleSpinResult(
    @MessageBody() data: SpinResultDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Spin result in ${data.roomId}: ${data.result}`);
    this.server.to(data.roomId).emit('spin-result', data.result);
  }

  @SubscribeMessage('host-ready-to-share')
  handleHostReadyToShare(
    @MessageBody() data: HostReadyDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Host ready to share in room: ${data.roomId}`);

    // Get all viewers in the room (excluding the host)
    const room = this.roomsService.findRoomById(data.roomId);
    if (!room) {
      console.log(`Room not found: ${data.roomId}`);
      return;
    }

    // Get socket IDs of all viewers (members except host)
    const viewerSocketIds: string[] = [];
    for (const memberId of room.members) {
      if (memberId !== room.hostId) {
        const socketId = this.roomsService.getUserSocket(memberId);
        if (socketId) {
          viewerSocketIds.push(socketId);
        }
      }
    }

    console.log(`Existing viewers in room ${data.roomId}:`, viewerSocketIds);

    // Send existing viewers back to host so they can create peer connections
    if (viewerSocketIds.length > 0) {
      client.emit('existing-viewers', {
        viewerIds: viewerSocketIds,
      });
    }
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody() data: OfferDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `Offer received for room: ${data.roomId}, sending to: ${data.to}`,
    );
    this.server.to(data.to).emit('offer', {
      offer: data.offer,
      from: client.id,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: AnswerDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Answer received from: ${client.id}`);
    // Send answer to all room members (host will filter it)
    client.to(data.roomId).emit('answer', {
      answer: data.answer,
      from: client.id,
    });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody() data: IceCandidateDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `ICE candidate from ${client.id}, to: ${data.to || 'broadcast'}`,
    );
    if (data.to) {
      // Send to specific peer
      this.server.to(data.to).emit('ice-candidate', {
        candidate: data.candidate,
        from: client.id,
      });
    } else {
      // Broadcast to room (for viewers sending to host)
      client.to(data.roomId).emit('ice-candidate', {
        candidate: data.candidate,
        from: client.id,
      });
    }
  }

  @SubscribeMessage('stop-sharing')
  handleStopSharing(
    @MessageBody() data: StopSharingDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Screen sharing stopped in room: ${data.roomId}`);
    client.to(data.roomId).emit('stop-sharing');
  }

  @SubscribeMessage('request-stream')
  handleRequestStream(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Viewer ${client.id} requesting stream in room: ${data.roomId}`);

    const room = this.roomsService.findRoomById(data.roomId);
    if (!room) {
      console.log(`Room not found: ${data.roomId}`);
      return;
    }

    // Forward request to host with viewer's socket ID
    const hostSocketId = this.roomsService.getUserSocket(room.hostId);
    if (hostSocketId) {
      this.server.to(hostSocketId).emit('request-stream', {
        viewerId: client.id,
      });
    }
  }
}
