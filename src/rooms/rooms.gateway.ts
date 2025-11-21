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
import { SendMessageDto } from 'src/firebase/dto/chat.dto';
import { Message } from 'src/firebase/entities/message.entity';
import { FirebaseService } from 'src/firebase/services/chat-firebase.service';
import { v4 as uuidv4 } from 'uuid';
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

  constructor(
    private readonly roomsService: RoomsService,
    private readonly firebaseService: FirebaseService,
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

    const result = this.roomsService.handleUserDisconnect(userId);
    if (result) {
      const roomId = this.roomsService.getUserRoom(userId);
      if (roomId) {
        this.server.to(roomId).emit('member-left', {
          memberId: result.memberId,
          members: result.members,
        });
        console.log(`${userId} left room: ${roomId}`);
      }

      if (result.roomDeleted) {
        console.log(`Room deleted: ${roomId}`);
      }
    }

    // Remove from logged-in users
    this.roomsService.removeLoggedInUser(userId);
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(
    @MessageBody() data: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    // Check if host is already in a room
    const existingRoomId = this.roomsService.getUserRoom(data.hostId);
    if (existingRoomId) {
      // Check if this is a different socket
      const existingSocketId = this.roomsService.getUserSocket(data.hostId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(`Disconnecting old socket ${existingSocketId} for host ${data.hostId}`);
        // Disconnect the old socket
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
          oldSocket.emit('error', {
            message: 'You have been disconnected because this account was opened in another tab/window.'
          });
          oldSocket.disconnect(true);
        }
      }

      // Leave the existing room first
      const result = this.roomsService.leaveRoom(existingRoomId, data.hostId);
      if (result) {
        void client.leave(existingRoomId);
        this.server.to(existingRoomId).emit('member-left', {
          memberId: result.memberId,
          members: result.members,
        });
        console.log(
          `${data.hostId} left previous room ${existingRoomId} to create new room`,
        );
      }
    }

    const room = this.roomsService.createRoom(data.hostId);
    const isRejoining = room.members.length > 1; // More than just host means existing viewers

    this.roomsService.setUserSocket(data.hostId, client.id);
    this.roomsService.setUserRoom(data.hostId, room.roomId);

    // Add host to logged-in users array
    this.roomsService.addLoggedInUser(data.hostId, data.name, room.roomId, client.id);

    void client.join(room.roomId);

    console.log(`Room created: ${room.roomId} by ${data.hostId} (${data.name})`);

    const membersWithDetails = this.roomsService.getRoomMembersWithDetails(room.roomId);

    client.emit('room-created', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
      membersWithDetails,
    });

    // If host is rejoining with existing viewers, notify them to reset WebRTC
    if (isRejoining) {
      console.log(`Host rejoined room ${room.roomId} with existing viewers, notifying them`);
      client.to(room.roomId).emit('host-reconnected', {
        hostId: data.hostId,
        hostSocketId: client.id,
      });
    }
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
  async handleJoinRoom(
    @MessageBody() data: JoinRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.roomsService.findRoomById(data.roomId);

    if (!room) {
      console.log(`Room not found: ${data.roomId}`);
      client.emit('error', { message: 'Room not found' });
      return;
    }

    // Check if user is logged in to this specific room already
    const isLoggedInToRoom = this.roomsService.isUserLoggedInToRoom(data.memberId, data.roomId);

    if (isLoggedInToRoom) {
      console.log(`${data.memberId} (${data.name}) is already logged into room ${data.roomId}`);

      // Check if this is a different socket (page reload scenario)
      const existingSocketId = this.roomsService.getUserSocket(data.memberId);
      if (existingSocketId && existingSocketId !== client.id) {
        console.log(`Kicking old session for ${data.memberId}, allowing new session`);
        // Disconnect the old socket
        const oldSocket = this.server.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
          oldSocket.emit('error', {
            message: 'You have been disconnected because this account was opened in another tab/window.'
          });
          oldSocket.disconnect(true);
        }

        // Update the socket mapping to the new connection
        this.roomsService.setUserSocket(data.memberId, client.id);
        this.roomsService.updateLoggedInUserSocket(data.memberId, client.id);
      }

      // Always join the socket to the room, regardless of whether it's a new or existing socket
      void client.join(data.roomId);

      const membersWithDetails = this.roomsService.getRoomMembersWithDetails(room.roomId);

      client.emit('room-joined', {
        roomId: room.roomId,
        hostId: room.hostId,
        members: room.members,
        membersWithDetails,
      });
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

    // Send messages history when user joined room
    const messages = await this.firebaseService.getMessages(data.roomId);
    client.emit('chat-history', { messages });

    // Notify host that a new viewer joined (for WebRTC setup)
    if (data.memberId !== updatedRoom.hostId) {
      const hostSocketId = this.roomsService.getUserSocket(updatedRoom.hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('viewer-joined', {
          viewerId: client.id,
        });
      }
    }
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
    // This event signals that host has started screen sharing
    // Viewers will be notified when they join via viewer-joined event
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

  @SubscribeMessage('send-message')
  async handleSendMessage(@MessageBody() data: SendMessageDto) {
    const message = new Message({
      id: uuidv4(),
      userId: data.userId,
      userName: data.userName,
      message: data.message,
      timestamp: Date.now(),
      roomId: data.roomId,
    });

    try {
      await this.firebaseService.saveMessage({ ...message });
    } catch (error) {
      console.error('Failed to save message:', error);
    }

    this.server.to(data.roomId).emit('chat-message', message);
  }
}
