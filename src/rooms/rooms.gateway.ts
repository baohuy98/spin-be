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
import { v4 } from 'uuid';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { LeaveRoomDto } from './dto/leave-room.dto';
import { LivestreamDto } from './dto/livestream-reaction.dto';
import { SpinResultDto } from './dto/spin-result.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { ValidateRoomDto } from './dto/validate-room.dto';
import {
  AnswerDto,
  HostReadyDto,
  IceCandidateDto,
  OfferDto,
  StopSharingDto,
} from './dto/webrtc.dto';
import {
  GetRouterRtpCapabilitiesDto,
  CreateTransportDto,
  ConnectTransportDto,
  ProduceDto,
  ConsumeDto,
  ResumeConsumerDto,
  GetProducersDto,
  CloseProducerDto,
} from './dto/mediasoup.dto';
import { RoomsService } from './services/rooms.service';
import { MediasoupService } from './services/mediasoup.service';

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
  private readonly DISCONNECT_GRACE_PERIOD = 5000; // 10 seconds for page reload

  constructor(
    private readonly roomsService: RoomsService,
    private readonly mediasoupService: MediasoupService,
    @Inject(STORAGE_SERVICE)
    private readonly storageService: StorageService,
  ) {}

  handleConnection(client: Socket) {
    console.log(`[CONNECTION] ✅ Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[DISCONNECT] ⚠️  Client disconnected: ${client.id}`);

    const userId = this.roomsService.findUserIdBySocketId(client.id);
    if (!userId) {
      console.log(
        `[DISCONNECT] ℹ️  No userId found for socket ${client.id}, ignoring`,
      );
      return;
    }

    const roomId = this.roomsService.getUserRoom(userId);
    const room = roomId ? this.roomsService.findRoomById(roomId) : null;
    const isHost = room && userId === room.hostId;

    // Use grace period for both host and viewers to handle page reloads
    console.log(
      `[DISCONNECT] ⏳ ${isHost ? 'Host' : 'Viewer'} ${userId} disconnected from room ${roomId}, starting ${this.DISCONNECT_GRACE_PERIOD}ms grace period`,
    );

    // Clear any existing pending disconnect for this user
    const existingTimeout = this.pendingDisconnects.get(userId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      console.log(
        `[DISCONNECT] 🔄 Cleared existing grace period for ${userId}`,
      );
    }

    // Set new pending disconnect with grace period
    const timeout = setTimeout(() => {
      console.log(
        `[DISCONNECT] ⏰ Grace period expired for ${userId}, processing disconnect`,
      );
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
      console.log(
        `[RECONNECT] ✅ Cancelled pending disconnect for ${userId} (user reconnected)`,
      );
      return true;
    }
    return false;
  }

  // Actually process the disconnect (remove from room, clean up)
  private processUserDisconnect(userId: string, roomId: string | undefined) {
    console.log(
      `[DISCONNECT] 🔧 Processing disconnect for ${userId} in room ${roomId}`,
    );

    // Safety check: if user already reconnected with a new socket, don't process disconnect
    const currentSocketId = this.roomsService.getUserSocket(userId);
    if (currentSocketId) {
      const socket = this.server.sockets.sockets.get(currentSocketId);
      if (socket && socket.connected) {
        console.log(
          `[DISCONNECT] ⏭️  User ${userId} already reconnected with socket ${currentSocketId}, skipping disconnect`,
        );
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
      console.log(`[DISCONNECT] 👋 ${userId} left room: ${roomId}`);

      if (result.roomDeleted) {
        console.log(
          `[DISCONNECT] 🗑️  Room deleted: ${roomId} (host left) - notifying remaining members`,
        );

        // Notify all viewers that room is deleted (host left)
        this.server.to(roomId).emit('room-deleted', {
          message: 'Host has left the room',
        });

        // Clean up mediasoup resources for this room
        console.log(
          `[DISCONNECT] 🧹 Cleaning up mediasoup resources for room ${roomId}`,
        );
        this.mediasoupService.closeRoom(roomId);
      }
    }

    // Remove from logged-in users
    this.roomsService.removeLoggedInUser(userId);
    console.log(
      `[DISCONNECT] ✅ User ${userId} fully disconnected and cleaned up`,
    );
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
    console.log(
      `[CREATE-ROOM] 📝 Request from hostId=${data.hostId}, name=${data.name}, socket=${client.id}`,
    );

    // Cancel any pending disconnect for this host (they're reconnecting)
    this.cancelPendingDisconnect(data.hostId);

    // Check if host already has an existing room (for rejoin scenario)
    const existingRoomId = this.roomsService.getUserRoom(data.hostId);
    const existingRoom = existingRoomId
      ? this.roomsService.findRoomById(existingRoomId)
      : null;
    const hasExistingViewers = existingRoom && existingRoom.members.length > 1;

    if (existingRoomId) {
      console.log(
        `[CREATE-ROOM] 🔍 Host ${data.hostId} already has room ${existingRoomId} with ${existingRoom?.members.length || 0} members`,
      );

      // Check if this is a different socket (host reconnecting/reloading)
      const existingSocketId = this.roomsService.getUserSocket(data.hostId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(
          `[CREATE-ROOM] 🔄 Host ${data.hostId} reconnecting: ${existingSocketId} -> ${client.id}`,
        );

        // Clean up old mediasoup transports and producers
        const closedProducerIds = this.mediasoupService.cleanupUserMedia(
          existingRoomId,
          existingSocketId,
        );
        if (closedProducerIds.length > 0) {
          console.log(
            `[CREATE-ROOM] 🧹 Cleaned up ${closedProducerIds.length} producers: ${closedProducerIds.join(', ')}`,
          );
          // Notify all viewers that producers were closed
          closedProducerIds.forEach((producerId) => {
            this.server
              .to(existingRoomId)
              .emit('producerClosed', { producerId });
            console.log(
              `[CREATE-ROOM] 📤 Sent producerClosed event for ${producerId} to room ${existingRoomId}`,
            );
          });
        }

        // Update socket mapping BEFORE disconnecting old socket
        // This ensures handleDisconnect won't find the old socket's userId
        this.roomsService.setUserSocket(data.hostId, client.id);

        // Now disconnect the old socket - handleDisconnect will ignore it
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
          oldSocket.disconnect(true);
          console.log(
            `[CREATE-ROOM] 🔌 Disconnected old socket ${existingSocketId}`,
          );
        }
      }

      // If there are existing viewers, DON'T delete the room - host is just rejoining
      if (!hasExistingViewers) {
        // No viewers, safe to clean up and recreate
        console.log(
          `[CREATE-ROOM] 🧹 No viewers in room ${existingRoomId}, cleaning up`,
        );
        const result = this.roomsService.leaveRoom(existingRoomId, data.hostId);
        if (result) {
          void client.leave(existingRoomId);
          console.log(
            `[CREATE-ROOM] 👋 ${data.hostId} left empty room ${existingRoomId}`,
          );
        }
      } else {
        console.log(
          `[CREATE-ROOM] 👥 Keeping room ${existingRoomId} with ${existingRoom.members.length - 1} existing viewers`,
        );
      }
    }

    // Get or create the room
    const room = this.roomsService.createRoom(data.hostId);
    const isRejoining = room.members.length > 1; // More than just host means existing viewers

    // Update host's socket mapping (may already be set above for reconnection)
    this.roomsService.setUserSocket(data.hostId, client.id);
    this.roomsService.setUserRoom(data.hostId, room.roomId);

    // Add/update host in logged-in users array
    this.roomsService.addLoggedInUser(
      data.hostId,
      data.name,
      room.roomId,
      client.id,
    );

    void client.join(room.roomId);

    console.log(
      `[CREATE-ROOM] ✅ Room ${isRejoining ? 'rejoined' : 'created'}: ${room.roomId} by ${data.hostId} (${data.name}), viewers: ${room.members.length - 1}`,
    );

    const membersWithDetails = this.roomsService.getRoomMembersWithDetails(
      room.roomId,
    );

    client.emit('room-created', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
      membersWithDetails,
      theme: room.theme || 'none',
    });
    console.log(
      `[CREATE-ROOM] 📤 Sent room-created event to host ${client.id}`,
    );

    // If host is rejoining with existing viewers, notify them to reset WebRTC
    if (isRejoining) {
      console.log(
        `[CREATE-ROOM] 🔔 Host rejoined room ${room.roomId} with ${room.members.length - 1} existing viewers, sending host-reconnected event`,
      );
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
    console.log(
      `[JOIN-ROOM] 📝 Request from memberId=${data.memberId}, name=${data.name}, roomId=${data.roomId}, socket=${client.id}`,
    );

    const room = this.roomsService.findRoomById(data.roomId);

    if (!room) {
      console.log(`[JOIN-ROOM] ❌ Room not found: ${data.roomId}`);
      client.emit('error', { message: 'Room not found' });
      return;
    }

    console.log(
      `[JOIN-ROOM] 🔍 Room ${data.roomId} found with ${room.members.length} members (host: ${room.hostId})`,
    );

    // Cancel any pending disconnect for this user (they're reconnecting)
    const wasReconnecting = this.cancelPendingDisconnect(data.memberId);

    // Check if user is already in room.members (they're rejoining/reconnecting)
    const isAlreadyInRoom = room.members.includes(data.memberId);

    // Check for duplicate name (only if not the same user reconnecting)
    if (!isAlreadyInRoom) {
      const membersWithDetails = this.roomsService.getRoomMembersWithDetails(
        data.roomId,
      );
      const duplicateName = membersWithDetails.find(
        (member) => member.name === data.name && member.genID !== data.memberId,
      );

      if (duplicateName) {
        console.log(
          `[JOIN-ROOM] ❌ Duplicate name detected: ${data.name} already exists in room ${data.roomId}`,
        );
        client.emit('error', {
          message: `The name "${data.name}" is already taken in this room. Please choose another name.`,
        });
        return;
      }
    }

    // Check if user is logged in to this specific room
    const isLoggedInToRoom = this.roomsService.isUserLoggedInToRoom(
      data.memberId,
      data.roomId,
    );

    // Handle reconnection: user is in room.members OR was in grace period OR is logged in
    if (isAlreadyInRoom || wasReconnecting || isLoggedInToRoom) {
      console.log(
        `[JOIN-ROOM] 🔄 ${data.memberId} (${data.name}) reconnecting to room ${data.roomId} [inRoom=${isAlreadyInRoom}, wasReconnecting=${wasReconnecting}, loggedIn=${isLoggedInToRoom}]`,
      );

      // Handle old socket if exists
      const existingSocketId = this.roomsService.getUserSocket(data.memberId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(
          `[JOIN-ROOM] 🔄 Viewer ${data.memberId} reconnecting: ${existingSocketId} -> ${client.id}`,
        );
        // Update socket mapping BEFORE disconnecting old socket
        // This ensures handleDisconnect won't find the old socket's userId
        this.roomsService.setUserSocket(data.memberId, client.id);

        // Now disconnect the old socket - handleDisconnect will ignore it
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket && oldSocket.connected) {
          oldSocket.disconnect(true);
          console.log(
            `[JOIN-ROOM] 🔌 Disconnected old socket ${existingSocketId}`,
          );
        }
      }

      // Update all mappings with new socket (may already be set above)
      this.roomsService.setUserSocket(data.memberId, client.id);
      this.roomsService.setUserRoom(data.memberId, data.roomId);
      this.roomsService.addLoggedInUser(
        data.memberId,
        data.name,
        data.roomId,
        client.id,
      );

      // Make sure user is in room.members (might have been removed during grace period)
      if (!isAlreadyInRoom) {
        console.log(
          `[JOIN-ROOM] 📝 Adding ${data.memberId} back to room.members`,
        );
        this.roomsService.joinRoom(data.roomId, data.memberId);
      }

      // Join the socket.io room
      void client.join(data.roomId);

      // Re-fetch room to get latest members after potential modifications
      const updatedRoom = this.roomsService.findRoomById(data.roomId);
      const latestMembers = updatedRoom?.members || room.members;
      const latestMembersWithDetails =
        this.roomsService.getRoomMembersWithDetails(data.roomId);

      client.emit('room-joined', {
        roomId: room.roomId,
        hostId: room.hostId,
        members: latestMembers,
        membersWithDetails: latestMembersWithDetails,
        theme: room.theme || 'none',
      });
      console.log(`[JOIN-ROOM] 📤 Sent room-joined event to ${client.id}`);

      // Broadcast member-joined to sync all clients' member lists
      client.to(data.roomId).emit('member-joined', {
        memberId: data.memberId,
        memberName: data.name,
        members: latestMembers,
        membersWithDetails: latestMembersWithDetails,
      });
      console.log(
        `[JOIN-ROOM] 📤 Sent member-joined event to room ${data.roomId}`,
      );

      // Notify host that viewer reconnected (for WebRTC setup)
      if (data.memberId !== room.hostId) {
        const hostSocketId = this.roomsService.getUserSocket(room.hostId);
        if (hostSocketId) {
          this.server.to(hostSocketId).emit('viewer-joined', {
            viewerId: client.id,
          });
          console.log(
            `[JOIN-ROOM] 📤 Sent viewer-joined event to host ${hostSocketId}`,
          );
        }
      }

      void this.handleGetChatHistory(client, data.roomId);
      console.log(
        `[JOIN-ROOM] ✅ ${data.memberId} (${data.name}) successfully reconnected to room ${data.roomId}`,
      );
      return;
    }

    // Check if user is already in a different room
    const existingRoomId = this.roomsService.getUserRoom(data.memberId);
    if (existingRoomId && existingRoomId !== data.roomId) {
      console.log(
        `[JOIN-ROOM] 🔄 ${data.memberId} is in different room ${existingRoomId}, leaving it first`,
      );
      // Leave the existing room first
      const result = this.roomsService.leaveRoom(existingRoomId, data.memberId);
      if (result) {
        void client.leave(existingRoomId);
        this.server.to(existingRoomId).emit('member-left', {
          memberId: result.memberId,
          members: result.members,
        });
        console.log(
          `[JOIN-ROOM] 👋 ${data.memberId} left previous room ${existingRoomId} to join ${data.roomId}`,
        );
      }
    }

    // Add member to room
    console.log(
      `[JOIN-ROOM] 📝 Adding new member ${data.memberId} (${data.name}) to room ${data.roomId}`,
    );
    const updatedRoom = this.roomsService.joinRoom(data.roomId, data.memberId);
    if (!updatedRoom) {
      console.log(`[JOIN-ROOM] ❌ Failed to join room ${data.roomId}`);
      client.emit('error', { message: 'Failed to join room' });
      return;
    }

    this.roomsService.setUserSocket(data.memberId, client.id);
    this.roomsService.setUserRoom(data.memberId, data.roomId);

    // Add user to logged-in users array
    this.roomsService.addLoggedInUser(
      data.memberId,
      data.name,
      data.roomId,
      client.id,
    );

    void client.join(data.roomId);

    console.log(
      `[JOIN-ROOM] ✅ ${data.memberId} (${data.name}) joined room: ${data.roomId} (total members: ${updatedRoom.members.length})`,
    );

    const membersWithDetails = this.roomsService.getRoomMembersWithDetails(
      data.roomId,
    );

    client.emit('room-joined', {
      roomId: updatedRoom.roomId,
      hostId: updatedRoom.hostId,
      members: updatedRoom.members,
      membersWithDetails,
      theme: updatedRoom.theme || 'none',
    });
    console.log(`[JOIN-ROOM] 📤 Sent room-joined event to ${client.id}`);

    client.to(data.roomId).emit('member-joined', {
      memberId: data.memberId,
      memberName: data.name,
      members: updatedRoom.members,
      membersWithDetails,
    });
    console.log(
      `[JOIN-ROOM] 📤 Sent member-joined broadcast to room ${data.roomId}`,
    );

    // Notify host that a new viewer joined (for WebRTC setup)
    if (data.memberId !== updatedRoom.hostId) {
      const hostSocketId = this.roomsService.getUserSocket(updatedRoom.hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('viewer-joined', {
          viewerId: client.id,
        });
        console.log(
          `[JOIN-ROOM] 📤 Sent viewer-joined event to host ${hostSocketId}`,
        );
      }
    }

    void this.handleGetChatHistory(client, data.roomId);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() data: LeaveRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[LEAVE-ROOM] 📝 Request from memberId=${data.memberId}, roomId=${data.roomId}, socket=${client.id}`,
    );

    const result = this.roomsService.leaveRoom(data.roomId, data.memberId);
    if (result) {
      this.server.to(data.roomId).emit('member-left', {
        memberId: result.memberId,
        members: result.members,
      });
      console.log(
        `[LEAVE-ROOM] 📤 Sent member-left event to room ${data.roomId}`,
      );

      if (result.roomDeleted) {
        console.log(
          `[LEAVE-ROOM] 🗑️  Room deleted: ${data.roomId} (host left)`,
        );
      }
    }

    this.roomsService.deleteUserSocket(data.memberId);
    this.roomsService.deleteUserRoom(data.memberId);
    this.roomsService.removeLoggedInUser(data.memberId);
    void client.leave(data.roomId);
    console.log(
      `[LEAVE-ROOM] ✅ ${data.memberId} left room ${data.roomId} and cleaned up`,
    );
  }

  @SubscribeMessage('spin-result')
  handleSpinResult(@MessageBody() data: SpinResultDto) {
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
      `[WEBRTC] 📡 Offer received from ${client.id} for room ${data.roomId}, sending to ${data.to}`,
    );
    this.server.to(data.to).emit('offer', {
      offer: data.offer,
      from: client.id,
    });
    console.log(`[WEBRTC] 📤 Sent offer to ${data.to}`);
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: AnswerDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[WEBRTC] 📡 Answer received from ${client.id} for room ${data.roomId}`,
    );
    // Send answer to all room members (host will filter it)
    client.to(data.roomId).emit('answer', {
      answer: data.answer,
      from: client.id,
    });
    console.log(`[WEBRTC] 📤 Sent answer broadcast to room ${data.roomId}`);
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @MessageBody() data: IceCandidateDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[WEBRTC] 🧊 ICE candidate from ${client.id}, to: ${data.to || 'broadcast to room ' + data.roomId}`,
    );
    if (data.to) {
      // Send to specific peer
      this.server.to(data.to).emit('ice-candidate', {
        candidate: data.candidate,
        from: client.id,
      });
      console.log(`[WEBRTC] 📤 Sent ICE candidate to ${data.to}`);
    } else {
      // Broadcast to room (for viewers sending to host)
      client.to(data.roomId).emit('ice-candidate', {
        candidate: data.candidate,
        from: client.id,
      });
      console.log(
        `[WEBRTC] 📤 Sent ICE candidate broadcast to room ${data.roomId}`,
      );
    }
  }

  @SubscribeMessage('stop-sharing')
  handleStopSharing(
    @MessageBody() data: StopSharingDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[WEBRTC] 🛑 Screen sharing stopped in room ${data.roomId} by ${client.id}`,
    );
    client.to(data.roomId).emit('stop-sharing');
    console.log(`[WEBRTC] 📤 Sent stop-sharing event to room ${data.roomId}`);
  }

  @SubscribeMessage('request-stream')
  handleRequestStream(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `Viewer ${client.id} requesting stream in room: ${data.roomId}`,
    );

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

  @SubscribeMessage('livestream-reaction')
  handleLivestreamReaction(
    @MessageBody() data: LivestreamDto,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.roomId).emit('livestream-reaction', {
      id: v4(),
      userName: data.userName,
      emoji: data.emoji,
      userId: data.userId,
    });
  }

  @SubscribeMessage('update-theme')
  handleUpdateTheme(
    @MessageBody() data: UpdateThemeDto,
    @ConnectedSocket() client: Socket,
  ) {
    // Update the room's theme in the service
    const success = this.roomsService.updateRoomTheme(data.roomId, data.theme);

    if (success) {
      // Broadcast the theme change to all members in the room (including the host)
      this.server.to(data.roomId).emit('theme-updated', {
        theme: data.theme,
      });
    } else {
      console.error(
        `[RoomsGateway] Failed to update theme for room ${data.roomId}`,
      );
    }
  }

  // ========== MEDIASOUP SIGNALING HANDLERS ==========

  @SubscribeMessage('getRouterRtpCapabilities')
  async handleGetRouterRtpCapabilities(
    @MessageBody() data: GetRouterRtpCapabilitiesDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[MEDIASOUP] 🎛️  Get router RTP capabilities for room ${data.roomId} from ${client.id}`,
    );

    // Create router if it doesn't exist
    await this.mediasoupService.createRouter(data.roomId);

    const rtpCapabilities = this.mediasoupService.getRouterRtpCapabilities(
      data.roomId,
    );
    client.emit('routerRtpCapabilities', { rtpCapabilities });
    console.log(`[MEDIASOUP] 📤 Sent router RTP capabilities to ${client.id}`);
  }

  @SubscribeMessage('createTransport')
  async handleCreateTransport(
    @MessageBody() data: CreateTransportDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[MEDIASOUP] 🚗 Create ${data.direction} transport for room ${data.roomId} from ${client.id}`,
    );

    const transportId = `${client.id}-${data.direction}`;
    const transportParams = await this.mediasoupService.createWebRtcTransport(
      data.roomId,
      transportId,
    );

    if (transportParams) {
      client.emit('transportCreated', {
        direction: data.direction,
        transportId,
        ...transportParams,
      });
      console.log(
        `[MEDIASOUP] ✅ Created ${data.direction} transport ${transportId} for ${client.id}`,
      );
    } else {
      console.log(
        `[MEDIASOUP] ❌ Failed to create ${data.direction} transport for ${client.id}`,
      );
      client.emit('error', { message: 'Failed to create transport' });
    }
  }

  @SubscribeMessage('connectTransport')
  async handleConnectTransport(
    @MessageBody() data: ConnectTransportDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[MEDIASOUP] 🔗 Connect transport ${data.transportId} from ${client.id}`,
    );

    const success = await this.mediasoupService.connectTransport(
      data.roomId,
      data.transportId,
      data.dtlsParameters,
    );

    if (success) {
      client.emit('transportConnected', { transportId: data.transportId });
      console.log(
        `[MEDIASOUP] ✅ Transport ${data.transportId} connected for ${client.id}`,
      );
    } else {
      console.log(
        `[MEDIASOUP] ❌ Failed to connect transport ${data.transportId}`,
      );
      client.emit('error', { message: 'Failed to connect transport' });
    }
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @MessageBody() data: ProduceDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[MEDIASOUP] 🎬 Produce ${data.kind} for room ${data.roomId} from ${client.id}`,
    );

    const serverProducerId = await this.mediasoupService.produce(
      data.roomId,
      data.transportId,
      data.kind,
      data.rtpParameters,
    );

    if (serverProducerId) {
      client.emit('produced', { kind: data.kind, id: serverProducerId });
      console.log(
        `[MEDIASOUP] ✅ Producer created: ${serverProducerId} (${data.kind}) for ${client.id}`,
      );

      // Notify all other clients in the room that a new producer is available
      client.to(data.roomId).emit('newProducer', {
        producerId: serverProducerId,
        kind: data.kind,
      });
      console.log(
        `[MEDIASOUP] 📤 Sent newProducer event to room ${data.roomId} for producer ${serverProducerId}`,
      );
    } else {
      console.log(
        `[MEDIASOUP] ❌ Failed to produce ${data.kind} for ${client.id}`,
      );
      client.emit('error', { message: 'Failed to produce' });
    }
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @MessageBody() data: ConsumeDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(
      `[Mediasoup] Consume request - Room: ${data.roomId}, TransportId: ${data.transportId}, ProducerId: ${data.producerId}`,
    );

    const consumerParams = await this.mediasoupService.consume(
      data.roomId,
      data.transportId,
      data.producerId,
      data.rtpCapabilities,
    );

    if (consumerParams) {
      console.log(
        `[Mediasoup] Consumer created successfully: ${consumerParams.id}`,
      );
      client.emit('consumed', consumerParams);
    } else {
      console.error(
        `[Mediasoup] Failed to consume - Room: ${data.roomId}, Transport: ${data.transportId}, Producer: ${data.producerId}`,
      );
      client.emit('error', { message: 'Failed to consume' });
    }
  }

  @SubscribeMessage('resumeConsumer')
  async handleResumeConsumer(
    @MessageBody() data: ResumeConsumerDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`[Mediasoup] Resume consumer: ${data.consumerId}`);

    const success = await this.mediasoupService.resumeConsumer(
      data.roomId,
      data.consumerId,
    );

    if (success) {
      client.emit('consumerResumed', { consumerId: data.consumerId });
    } else {
      client.emit('error', { message: 'Failed to resume consumer' });
    }
  }

  @SubscribeMessage('getProducers')
  handleGetProducers(
    @MessageBody() data: GetProducersDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`[Mediasoup] Get producers for room: ${data.roomId}`);

    const producers = this.mediasoupService.getProducers(data.roomId);
    client.emit('producers', { producers });
  }

  @SubscribeMessage('closeProducer')
  handleCloseProducer(
    @MessageBody() data: CloseProducerDto,
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`[Mediasoup] Close producer: ${data.producerId}`);

    this.mediasoupService.closeProducer(data.roomId, data.producerId);

    // Notify all viewers that this producer is closed
    client.to(data.roomId).emit('producerClosed', {
      producerId: data.producerId,
    });
  }
}
