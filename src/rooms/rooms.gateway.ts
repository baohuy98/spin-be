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
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(
    @MessageBody() data: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ) {
    // Check if user is already in a room
    const existingRoomId = this.roomsService.getUserRoom(data.hostId);
    if (existingRoomId) {
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
    this.roomsService.setUserSocket(data.hostId, client.id);
    this.roomsService.setUserRoom(data.hostId, room.roomId);
    void client.join(room.roomId);

    console.log(`Room created: ${room.roomId} by ${data.hostId}`);

    client.emit('room-created', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
    });
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

    // Check if user is already in this room (avoid duplicate)
    if (existingRoomId === data.roomId) {
      console.log(`${data.memberId} is already in room ${data.roomId}`);
      client.emit('room-joined', {
        roomId: room.roomId,
        hostId: room.hostId,
        members: room.members,
      });
      return;
    }

    // Add member to room
    const updatedRoom = this.roomsService.joinRoom(data.roomId, data.memberId);
    if (!updatedRoom) {
      client.emit('error', { message: 'Failed to join room' });
      return;
    }

    this.roomsService.setUserSocket(data.memberId, client.id);
    this.roomsService.setUserRoom(data.memberId, data.roomId);
    void client.join(data.roomId);

    console.log(`${data.memberId} joined room: ${data.roomId}`);

    client.emit('room-joined', {
      roomId: updatedRoom.roomId,
      hostId: updatedRoom.hostId,
      members: updatedRoom.members,
    });

    client.to(data.roomId).emit('member-joined', {
      memberId: data.memberId,
      members: updatedRoom.members,
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
