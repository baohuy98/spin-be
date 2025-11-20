import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Room {
  roomId: string;
  hostId: string;
  members: string[];
  createdAt: Date;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RoomsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private rooms: Map<string, Room> = new Map();
  private userSocketMap: Map<string, string> = new Map();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    this.rooms.forEach((room, roomId) => {
      const index = room.members.indexOf(client.id);
      if (index > -1) {
        room.members.splice(index, 1);

        this.server.to(roomId).emit('member-left', {
          memberId: client.id,
          members: room.members,
        });

        if (room.members.length === 0) {
          this.rooms.delete(roomId);
          console.log(`Room deleted: ${roomId}`);
        }
      }
    });
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(
    @MessageBody() data: { hostId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const roomId = `room-${Date.now()}`;
    const room: Room = {
      roomId,
      hostId: data.hostId,
      members: [data.hostId],
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.userSocketMap.set(data.hostId, client.id);
    client.join(roomId);

    console.log(`Room created: ${roomId} by ${data.hostId}`);

    client.emit('room-created', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
    });
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string; memberId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.rooms.get(data.roomId);

    if (!room) {
      client.emit('error', { message: 'Room not found' });
      return;
    }

    if (!room.members.includes(data.memberId)) {
      room.members.push(data.memberId);
    }

    this.userSocketMap.set(data.memberId, client.id);
    client.join(data.roomId);

    console.log(`${data.memberId} joined room: ${data.roomId}`);

    client.emit('room-joined', {
      roomId: room.roomId,
      hostId: room.hostId,
      members: room.members,
    });

    client.to(data.roomId).emit('member-joined', {
      memberId: data.memberId,
      members: room.members,
    });

    // Notify host that a new viewer joined (for WebRTC setup)
    if (data.memberId !== room.hostId) {
      const hostSocketId = this.userSocketMap.get(room.hostId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('viewer-joined', {
          viewerId: client.id,
        });
      }
    }
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() data: { roomId: string; memberId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.rooms.get(data.roomId);

    if (!room) {
      return;
    }

    const index = room.members.indexOf(data.memberId);
    if (index > -1) {
      room.members.splice(index, 1);
    }

    this.userSocketMap.delete(data.memberId);
    client.leave(data.roomId);

    console.log(`${data.memberId} left room: ${data.roomId}`);

    this.server.to(data.roomId).emit('member-left', {
      memberId: data.memberId,
      members: room.members,
    });

    if (room.members.length === 0) {
      this.rooms.delete(data.roomId);
      console.log(`Room deleted: ${data.roomId}`);
    }
  }

  @SubscribeMessage('spin-result')
  handleSpinResult(
    @MessageBody() data: { roomId: string; result: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Spin result in ${data.roomId}: ${data.result}`);
    this.server.to(data.roomId).emit('spin-result', data.result);
  }

  @SubscribeMessage('host-ready-to-share')
  handleHostReadyToShare(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Host ready to share in room: ${data.roomId}`);
    // This event signals that host has started screen sharing
    // Viewers will be notified when they join via viewer-joined event
  }

  @SubscribeMessage('offer')
  handleOffer(
    @MessageBody()
    data: { roomId: string; offer: RTCSessionDescriptionInit; to: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Offer received for room: ${data.roomId}, sending to: ${data.to}`);
    this.server.to(data.to).emit('offer', {
      offer: data.offer,
      from: client.id,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody()
    data: { roomId: string; answer: RTCSessionDescriptionInit },
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
    @MessageBody()
    data: { roomId: string; candidate: RTCIceCandidateInit; to?: string },
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
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Screen sharing stopped in room: ${data.roomId}`);
    client.to(data.roomId).emit('stop-sharing');
  }
}
